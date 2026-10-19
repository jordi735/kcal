import { useEffect, useRef, useState } from 'preact/hooks';

export const FADE_EXIT_MS = 300;

export function useFadeClose(onClose: () => void): {
  closing: boolean;
  requestClose: () => void;
} {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const requestClose = () => {
    if (timer.current !== null) return;
    setClosing(true);
    timer.current = setTimeout(onClose, FADE_EXIT_MS);
  };
  return { closing, requestClose };
}
