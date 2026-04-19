// AI label scanner modal — auto-opens the OS camera on mount, POSTs the photo
// to /products/from-image, hands the parsed ExtractedLabel back to the parent.
// Phases: camera (OS covers UI) -> processing (loader) -> onExtracted, or -> error.

import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { useFadeClose } from '../hooks/useFadeClose';
import type { Macros } from '../types';
import styles from './AILabelScanner.module.css';

export type ExtractedLabel = {
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  per100: Macros;
};

export type AILabelScannerProps = {
  onExtracted: (label: ExtractedLabel) => void;
  onClose: () => void;
};

type Phase = 'camera' | 'processing' | 'error';

export function AILabelScanner({ onExtracted, onClose }: AILabelScannerProps) {
  const [phase, setPhase] = useState<Phase>('camera');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { closing, requestClose } = useFadeClose(onClose);

  useEffect(() => {
    const input = fileInputRef.current;
    if (input === null) return;
    // Fires when the OS camera UI is dismissed without capturing — bail back
    // to the caller instead of leaving an empty modal on screen.
    const onCancel = () => requestClose();
    input.addEventListener('cancel', onCancel);
    input.click();
    return () => input.removeEventListener('cancel', onCancel);
  }, []);

  const openCamera = () => {
    setPhase('camera');
    setError(null);
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: Event): Promise<void> => {
    const target = e.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (file === undefined) return;
    setPhase('processing');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const result = await api<ExtractedLabel>('/products/from-image', {
        method: 'POST',
        body: fd,
      });
      onExtracted(result);
    } catch (err) {
      let msg = 'Scan failed';
      if (err instanceof ApiError) {
        if (err.status === 429) msg = 'Daily scan limit reached';
        else if (err.status === 422) msg = "Couldn't read the label";
      }
      setError(msg);
      setPhase('error');
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFileChange}
        className={styles.fileInput}
      />
      <div
        className={`overlay ${styles.overlayDark}${closing ? ' exiting' : ''}`}
        onClick={phase === 'camera' ? requestClose : undefined}
      />
      <div className={`${styles.shell}${closing ? ' fullscreen-exit' : ''}`}>
        {phase === 'processing' && (
          <div className={styles.center}>
            <div className={styles.spinner} />
            <div className={`mono tiny caps ${styles.statusText}`}>
              Reading label<span className="dot-pulse">...</span>
            </div>
          </div>
        )}
        {phase === 'error' && (
          <div className={styles.center}>
            <div className={`mono tiny ${styles.errorText}`}>
              {error}
            </div>
            <button className="btn-primary" onClick={openCamera}>Try again</button>
            <button className="btn-ghost" onClick={requestClose}>Cancel</button>
          </div>
        )}
      </div>
    </>
  );
}
