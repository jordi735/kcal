// Bottom-sheet wrapper with drag-to-dismiss on the handle and a matching
// exit animation when closed via overlay click / Cancel button. Pointer
// events only — they cover touch + mouse everywhere the app runs. Drag
// threshold is 80px before we commit to dismissing.
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

export function Sheet({ onClose, children, style }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const registerClose = useContext(SheetCloseRegisterContext);
  const dragRef = useRef({
    startY: 0,
    pointerId: -1,
    active: false,
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

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (exiting) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, pointerId: e.pointerId, active: true };
    sheetRef.current?.classList.remove('sheet--snapping', 'sheet--dismissing');
  };

  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const deltaY = e.clientY - dragRef.current.startY;
    if (sheetRef.current === null) return;
    sheetRef.current.style.transform =
      deltaY > 0 ? `translateY(${deltaY}px)` : 'translateY(0)';
  };

  const onPointerEnd = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const deltaY = e.clientY - dragRef.current.startY;
    dragRef.current.active = false;
    if (sheetRef.current === null) return;
    const sheet = sheetRef.current;

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
      sheet.style.transition = 'transform 0.25s ease-in';
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

  return (
    <SheetCloseContext.Provider value={requestClose}>
      <div
        className={`sheet${exiting ? ' exiting' : ''}`}
        ref={sheetRef}
        style={style}
      >
        <div
          className="sheet-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
        {children}
      </div>
    </SheetCloseContext.Provider>
  );
}
