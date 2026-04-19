// Bottom-sheet wrapper with drag-to-dismiss on the whole sheet and a
// matching exit animation when closed via overlay click / Cancel button.
// Pointer events only — they cover touch + mouse everywhere the app runs.
// The drag is reactive only when the internal scroll container (if any)
// is at scrollTop === 0; upward drags stay at translateY(0) so native
// scroll in inner containers can take over via pointercancel. Drag
// threshold is 80px before we commit to dismissing.
//
// Children inside the sheet can trigger a close-with-animation by calling
// `useSheetClose()` from context. The component's `onClose` prop is the
// "truly close / unmount me" signal — Sheet fires it 250ms after it
// starts animating out.

import { createContext } from 'preact';
import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';

export type SheetProps = {
  onClose: () => void;
  children: ComponentChildren;
  scrollRef?: RefObject<HTMLDivElement>;
  style?: JSX.CSSProperties;
};

const DISMISS_THRESHOLD_PX = 80;
const EXIT_MS = 250;

const SheetCloseContext = createContext<(() => void) | null>(null);

export function useSheetClose(): () => void {
  const close = useContext(SheetCloseContext);
  if (close === null) {
    throw new Error('useSheetClose must be used inside a <Sheet>');
  }
  return close;
}

export function Sheet({ onClose, children, scrollRef, style }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef({
    startY: 0,
    pointerId: -1,
    active: false,
  });

  // Start the exit animation; call parent onClose once it finishes.
  const requestClose = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      onClose();
    }, EXIT_MS);
  }, [exiting, onClose]);

  // Guard: if this component unmounts mid-exit (e.g. parent force-closes),
  // clear the pending timer so a stale onClose doesn't fire.
  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
    };
  }, []);

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (exiting) return;
    // Only start a drag if the user can actually dismiss — list must be at
    // the top. Cache this once at pointerdown so mid-drag scrolls don't
    // retroactively enable dismissal. Pointer is intentionally NOT captured
    // so the browser can still hand the gesture off to native scroll on
    // inner scroll containers (via pointercancel) when the user scrolls up.
    const scrollTop = scrollRef?.current?.scrollTop ?? 0;
    if (scrollTop > 0) return;
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
      // Clear the inline transform in the same synchronous tick that we
      // add the class, so the browser sees transform go from e.g. 150px
      // (inline) to translateY(100%) (class) — transitions fire and the
      // sheet glides off from wherever the finger was.
      sheet.style.transform = '';
      sheet.classList.add('sheet--dismissing');
      requestClose();
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
        className={`overlay${exiting ? ' exiting' : ''}`}
        onClick={requestClose}
      />
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
