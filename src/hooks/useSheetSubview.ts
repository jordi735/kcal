import { useLayoutEffect, useRef, useState } from 'preact/hooks';

// Host forms remain mounted while a local Sheet subview is visible. Returning
// restores the opening button without clearing a draft by focusing its input.
export function useSheetSubview(initialOpen = false) {
  const [isOpen, setOpen] = useState(initialOpen);
  const trigger = useRef<HTMLButtonElement | null>(null);

  // Commit-time restoration also avoids a delayed initial effect clearing the
  // trigger after a quick opening click but before the subview's first render.
  useLayoutEffect(() => {
    if (!isOpen && trigger.current !== null) {
      trigger.current.focus({ preventScroll: true });
      trigger.current = null;
    }
  }, [isOpen]);

  return {
    isOpen,
    open: (button: HTMLButtonElement) => {
      trigger.current = button;
      setOpen(true);
    },
    close: () => setOpen(false),
  };
}
