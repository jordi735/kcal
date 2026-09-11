import { useEffect, useState } from 'preact/hooks';
import { FADE_EXIT_MS } from '../hooks/useFadeClose';

// Shared backdrop for sheet-style modals — stays mounted across sheet-to-sheet
// transitions so the dim layer never flashes between them. The active Sheet
// signals exit so the overlay fades in parallel with its slide-off.
export function SheetOverlay({
  visible,
  exiting,
  onClick,
}: {
  visible: boolean;
  exiting: boolean;
  onClick: () => void;
}) {
  const [render, setRender] = useState(visible);

  useEffect(() => {
    if (visible) {
      setRender(true);
      return;
    }
    if (!render) return;
    // The sheet already signaled exit, so its parallel fade is complete.
    if (exiting) {
      setRender(false);
      return;
    }
    const t = window.setTimeout(() => setRender(false), FADE_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [visible, render, exiting]);

  if (!render) return null;
  const fading = exiting || !visible;
  return <div className={`overlay${fading ? ' exiting' : ''}`} onClick={onClick} />;
}
