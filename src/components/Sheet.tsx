// Bottom-sheet wrapper. The entire surface is draggable to dismiss (iOS-
// style), but scroll takes priority: if the gesture starts inside a
// [data-sheet-scroll] element with scrollTop > 0, it's scroll-only. If
// scrollTop === 0, pulling down engages drag; pulling up scrolls. Outside
// any scroll container, any downward drag dismisses.
//
// Mobile uses non-passive native touch listeners so we can preventDefault
// the browser's native scroll when we want to drag — Preact JSX touch
// handlers are passive by default, and pointer events on mobile get
// pointercancel'd once the browser claims the gesture for scroll.
// Desktop uses pointer events with pointer capture; targets inside text
// inputs are skipped so native focus/selection keeps working.
//
// Threshold for commit-to-dismiss is 80px. Shorter drags snap back via
// .sheet--snapping.
//
// Children inside the sheet can trigger a close-with-animation by calling
// `useSheetClose()` from context. The component's `onClose` prop is the
// "truly close / unmount me" signal — Sheet fires it 250ms after it
// starts animating out.
//
// The dimmed backdrop is hoisted to App (see SheetCloseRegisterProvider)
// so it persists across sheet-to-sheet transitions. The active Sheet
// registers its `requestClose` upward so App's shared overlay can fire it
// on tap.

import { createContext } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { FADE_EXIT_MS } from '../hooks/useFadeClose';

type SheetProps = {
  onClose: () => void;
  children: ComponentChildren;
  style?: JSX.CSSProperties;
};

const DISMISS_THRESHOLD_PX = 80;
const SLOP_PX = 6;

const SheetCloseContext = createContext<(() => void) | null>(null);

type SheetCloseRegister = (fn: (() => void) | null) => void;
const SheetCloseRegisterContext = createContext<SheetCloseRegister | null>(null);

export function SheetCloseRegisterProvider({
  register,
  children,
}: {
  register: SheetCloseRegister;
  children: ComponentChildren;
}) {
  return (
    <SheetCloseRegisterContext.Provider value={register}>
      {children}
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
  pointerId: number;
};

export function Sheet({ onClose, children, style }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const registerClose = useContext(SheetCloseRegisterContext);
  const dragRef = useRef<DragState>({
    active: false,
    phase: 'undecided',
    startY: 0,
    pointerId: -1,
  });

  // Stable identity so context consumers and the App register effect don't
  // churn when `onClose` or `exiting` change.
  const requestClose = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    exitTimerRef.current = setTimeout(() => onCloseRef.current(), FADE_EXIT_MS);
  }, []);

  // Guard: if this component unmounts mid-exit (e.g. parent force-closes),
  // clear the pending timer so a stale onClose doesn't fire.
  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (registerClose === null) return;
    registerClose(requestClose);
    return () => registerClose(null);
  }, [registerClose, requestClose]);

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
      pointerId: -1,
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
      // Drive the slide-off via inline styles, NOT a class + requestClose().
      // requestClose() flips `exiting` state; React then re-renders this
      // div and rewrites its className from scratch, wiping any
      // imperatively-added class (`.sheet--dismissing`) and letting the
      // .sheet.exiting keyframe (slideDown from translateY(0)) override
      // the transition — the exact "pop back to top" artifact we're
      // avoiding. Inline styles survive reconciliation because the JSX
      // `style` prop doesn't mention these keys.
      if (exitingRef.current) return;
      exitingRef.current = true;
      sheet.style.transition = 'transform 0.3s ease-in';
      sheet.style.transform = 'translateY(100%)';
      sheet.style.pointerEvents = 'none';
      exitTimerRef.current = setTimeout(() => onCloseRef.current(), FADE_EXIT_MS);
    } else {
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
  // fire with the touch listeners above on mobile.
  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (!beginGesture(e.target, e.clientY, false)) return;
    dragRef.current.pointerId = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (dragRef.current.pointerId !== e.pointerId) return;
    updateGesture(e.clientY);
  };
  const onPointerEnd = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (dragRef.current.pointerId !== e.pointerId) return;
    endGesture(e.clientY);
  };

  return (
    <SheetCloseContext.Provider value={requestClose}>
      <div
        className={`sheet${exiting ? ' exiting' : ''}`}
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
