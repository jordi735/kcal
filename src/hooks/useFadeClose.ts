import { useState } from 'preact/hooks';
import { useBackClose } from './useBackClose';

export const FADE_EXIT_MS = 300;

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
  useBackClose(requestClose);
  return { closing, requestClose };
}
