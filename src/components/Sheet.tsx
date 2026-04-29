// Bottom-sheet wrapper. The entire surface is draggable to dismiss (iOS-
// style), but scroll takes priority: if the gesture starts inside a
// [data-sheet-scroll] element with scrollTop > 0, it's scroll-only. If
// scrollTop === 0, pulling down engages drag; pulling up scrolls. Outside
// any scroll container, any downward drag dismisses.
//
// Two independent input paths, each handles one platform:
// - Mobile: native `touchstart`/`touchmove`/`touchend` listeners attached
//   via addEventListener({ passive: false }) so the handler can call
//   `preventDefault()` to block the browser's own scroll once we've
//   committed to drag. Preact JSX touch handlers are passive-by-default
//   and can't do this.
// - Desktop: JSX pointer handlers. `pointerType === 'touch'` is filtered
//   out so mobile doesn't double-fire. `setPointerCapture` is deferred
//   until the drag phase actually commits to 'dragging' — capturing on
//   `pointerdown` would redirect `pointerup` to the sheet and swallow
//   click events on child buttons.
// Targets inside text inputs are skipped so native focus/selection keeps
// working.
//
// Threshold for commit-to-dismiss is 80px. Shorter drags snap back via
// .sheet--snapping.
//
// Close animation: every exit path flows through `beginExit()`, which drives
// the slide-off via inline styles so the animation starts from wherever the
// sheet currently is. Two intent-flavored callbacks decide what happens
// AFTER the slide-off:
//   - Cancel button (`useSheetClose()` from context) → `onClose`. Parents may
//     wire this to back-nav (e.g. NewProductForm → AddPicker).
//   - Backdrop tap and drag-commit → `onDismiss ?? onClose`. iOS-style
//     interactive dismiss should always tear the sheet down, never unwind
//     to a previous sheet, even when `onClose` would back-nav.
//
// The dimmed backdrop is hoisted to App (see SheetCloseRegisterProvider)
// so it persists across sheet-to-sheet transitions. The active Sheet
// registers its `requestDismiss` and a `notifyExit` signal upward so the
// App-owned overlay can both tap-dismiss and fade in parallel with the
// sheet's slide-off.

import { createContext } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { useCallback, useContext, useEffect, useRef } from 'preact/hooks';
import { FADE_EXIT_MS } from '../hooks/useFadeClose';

type SheetProps = {
  onClose: () => void;
  // Optional override for backdrop-tap and drag-commit dismiss paths. Wire
  // this when `onClose` performs back-nav so interactive dismiss still
  // fully closes the sheet stack. Falls back to `onClose` when omitted.
  onDismiss?: () => void;
  children: ComponentChildren;
  style?: JSX.CSSProperties;
};

const DISMISS_THRESHOLD_PX = 80;
const SLOP_PX = 6;

const SheetCloseContext = createContext<(() => void) | null>(null);

type SheetCloseRegister = (fn: (() => void) | null) => void;
type SheetExitNotify = () => void;

const SheetCloseRegisterContext = createContext<SheetCloseRegister | null>(null);
const SheetExitNotifyContext = createContext<SheetExitNotify | null>(null);

export function SheetCloseRegisterProvider({
  register,
  notifyExit,
  children,
}: {
  register: SheetCloseRegister;
  notifyExit: SheetExitNotify;
  children: ComponentChildren;
}) {
  return (
    <SheetCloseRegisterContext.Provider value={register}>
      <SheetExitNotifyContext.Provider value={notifyExit}>
        {children}
      </SheetExitNotifyContext.Provider>
    </SheetCloseRegisterContext.Provider>
  );
}

export function useSheetClose(): () => void {
  const close = useContext(SheetCloseContext);
  if (close === null) {
    throw new Error('useSheetClose must be used inside a <Sheet>');
  }
  return close;
}

type Phase = 'undecided' | 'dragging' | 'scrolling';

type DragState = {
  active: boolean;
  phase: Phase;
  startY: number;
};

export function Sheet({ onClose, onDismiss, children, style }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const registerClose = useContext(SheetCloseRegisterContext);
  const notifyExit = useContext(SheetExitNotifyContext);
  const notifyExitRef = useRef(notifyExit);
  notifyExitRef.current = notifyExit;
  const dragRef = useRef<DragState>({
    active: false,
    phase: 'undecided',
    startY: 0,
  });
  const pointerIdRef = useRef<number>(-1);

  // Every exit funnels through here. Inline styles — not a CSS keyframe —
  // so the slide-off starts from wherever the sheet currently is (the
  // finger's release position during drag, or translateY(0) for a button
  // tap). Notifying App on exit lets the shared overlay fade in parallel.
  // `kind` decides which callback fires after the slide-off: 'close' is
  // the explicit Cancel-button path (parent decides — may back-nav);
  // 'dismiss' is the gesture/backdrop path (always fully tear down, with
  // `onClose` as a fallback for sheets that don't need the distinction).
  const beginExit = useCallback((kind: 'close' | 'dismiss') => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    notifyExitRef.current?.();
    const sheet = sheetRef.current;
    if (sheet !== null) {
      sheet.style.transition = 'transform 0.3s ease-in';
      sheet.style.transform = 'translateY(100%)';
      sheet.style.pointerEvents = 'none';
    }
    const finalize =
      kind === 'dismiss'
        ? (onDismissRef.current ?? onCloseRef.current)
        : onCloseRef.current;
    exitTimerRef.current = setTimeout(() => finalize(), FADE_EXIT_MS);
  }, []);

  const requestClose = useCallback(() => beginExit('close'), [beginExit]);
  const requestDismiss = useCallback(() => beginExit('dismiss'), [beginExit]);

  // Guard: if this component unmounts mid-exit (e.g. parent force-closes),
  // clear the pending timer so a stale onClose doesn't fire.
  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (registerClose === null) return;
    // Backdrop tap routes through the registered callback; register the
    // dismiss path so a tap on the dim layer always fully closes, even
    // when `onClose` would back-nav to a previous sheet.
    registerClose(requestDismiss);
    return () => registerClose(null);
  }, [registerClose, requestDismiss]);

  // respectScroll=true for touch (mobile): if the finger lands inside a
  // scroll container that's already scrolled down, the gesture is scroll-
  // only from frame one. respectScroll=false for mouse/pen (desktop):
  // mouse drag never conflicts with scroll (wheel handles that), so drag
  // always gets the chance to engage.
  const beginGesture = (
    target: EventTarget | null,
    clientY: number,
    respectScroll: boolean,
  ): boolean => {
    if (exitingRef.current) return false;
    if (sheetRef.current === null) return false;
    // Skip text inputs so native focus/selection keeps working.
    if (target instanceof Element && target.closest('input, textarea, select') !== null) {
      return false;
    }
    sheetRef.current.classList.remove('sheet--snapping');

    let phase: Phase = 'undecided';
    if (respectScroll) {
      const scrollEl = sheetRef.current.querySelector<HTMLElement>('[data-sheet-scroll]');
      const insideScroll =
        target instanceof Element &&
        scrollEl !== null &&
        target.closest('[data-sheet-scroll]') === scrollEl;
      if (insideScroll && scrollEl!.scrollTop > 0) phase = 'scrolling';
    }

    dragRef.current = {
      active: true,
      phase,
      startY: clientY,
    };
    return true;
  };

  const updateGesture = (clientY: number): Phase => {
    const drag = dragRef.current;
    if (!drag.active) return drag.phase;
    const deltaY = clientY - drag.startY;

    if (drag.phase === 'undecided') {
      if (deltaY > SLOP_PX) drag.phase = 'dragging';
      else if (deltaY < -SLOP_PX) drag.phase = 'scrolling';
    }

    if (drag.phase === 'dragging' && sheetRef.current !== null) {
      sheetRef.current.style.transform =
        deltaY > 0 ? `translateY(${deltaY}px)` : 'translateY(0)';
    }

    return drag.phase;
  };

  const endGesture = (clientY: number) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    if (drag.phase !== 'dragging') return;
    if (sheetRef.current === null) return;
    const sheet = sheetRef.current;
    const deltaY = clientY - drag.startY;

    if (deltaY >= DISMISS_THRESHOLD_PX) {
      requestDismiss();
    } else {
      // Skip the snap-back animation when the sheet is already at translateY(0)
      // — `updateGesture` writes that value for any deltaY <= 0. Re-writing the
      // same value doesn't fire `transitionend`, leaking the listener and
      // stranding the `sheet--snapping` class until next drag.
      if (deltaY <= 0) return;
      const onSnap = () => {
        sheet.removeEventListener('transitionend', onSnap);
        sheet.classList.remove('sheet--snapping');
      };
      sheet.addEventListener('transitionend', onSnap);
      sheet.classList.add('sheet--snapping');
      sheet.style.transform = 'translateY(0)';
    }
  };

  // Mobile touch path: non-passive so we can preventDefault native scroll
  // while the gesture is still ours (undecided or dragging). Once phase
  // commits to 'scrolling' we release control and the browser pans.
  useEffect(() => {
    const el = sheetRef.current;
    if (el === null) return;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t === undefined) return;
      beginGesture(e.target, t.clientY, true);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragRef.current.active) return;
      const t = e.touches[0];
      if (t === undefined) return;
      const phase = updateGesture(t.clientY);
      if (phase !== 'scrolling') e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!dragRef.current.active) return;
      const t = e.changedTouches[0];
      if (t === undefined) {
        dragRef.current.active = false;
        return;
      }
      endGesture(t.clientY);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  // Desktop mouse / pen. Ignore pointerType='touch' so we don't double-
  // fire with the touch listeners above on mobile. Capture is deferred
  // until the drag commits — capturing on pointerdown would swallow
  // clicks on child buttons inside the sheet.
  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (!beginGesture(e.target, e.clientY, false)) return;
    pointerIdRef.current = e.pointerId;
  };
  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (pointerIdRef.current !== e.pointerId) return;
    const wasDragging = dragRef.current.phase === 'dragging';
    updateGesture(e.clientY);
    if (!wasDragging && dragRef.current.phase === 'dragging') {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const onPointerEnd = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (pointerIdRef.current !== e.pointerId) return;
    endGesture(e.clientY);
  };

  return (
    <SheetCloseContext.Provider value={requestClose}>
      <div
        className="sheet"
        ref={sheetRef}
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div className="sheet-handle" />
        {children}
      </div>
    </SheetCloseContext.Provider>
  );
}
