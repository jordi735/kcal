import { useState } from 'preact/hooks';

export const FADE_EXIT_MS = 250;

export function useFadeClose(onClose: () => void): {
  closing: boolean;
  requestClose: () => void;
} {
  const [closing, setClosing] = useState(false);
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, FADE_EXIT_MS);
  };
  return { closing, requestClose };
}
