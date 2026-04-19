// AI label scanner modal — pick a nutrition label photo, POST to
// /products/from-image, hand the parsed ExtractedLabel back to the parent.
// States: aim -> thinking -> done; error branches back to aim.

import { useRef, useState } from 'preact/hooks';
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

type ScanState = 'aim' | 'thinking' | 'done';

const LABEL_ROWS = ['Energy  520 kcal', 'Protein  18 g', 'Carbs   42 g', 'Fat     28 g', 'Sugar    6 g', 'Salt   0.8 g'];

export function AILabelScanner({ onExtracted, onClose }: AILabelScannerProps) {
  const [state, setState] = useState<ScanState>('aim');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { closing, requestClose } = useFadeClose(onClose);

  const onFileChange = async (e: Event): Promise<void> => {
    const target = e.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (file === undefined) return;
    setState('thinking');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const result = await api<ExtractedLabel>('/products/from-image', {
        method: 'POST',
        body: fd,
      });
      setState('done');
      setTimeout(() => onExtracted(result), 600);
    } catch (err) {
      let msg = 'Scan failed';
      if (err instanceof ApiError) {
        if (err.status === 429) msg = 'Daily scan limit reached';
        else if (err.status === 422) msg = "Couldn't read the label";
      }
      setError(msg);
      setState('aim');
    }
  };

  const openPicker = () => fileInputRef.current?.click();

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
        onClick={state === 'aim' ? requestClose : undefined}
      />
      <div className={`${styles.shell}${closing ? ' fullscreen-exit' : ''}`}>
        <div className={styles.topbar}>
          <span className={`mono caps ${styles.topbarTitle}`}>SCAN LABEL · AI</span>
          <button
            onClick={state === 'aim' ? requestClose : undefined}
            disabled={state !== 'aim'}
            className={styles.closeBtn}
          >×</button>
        </div>

        <div className={styles.viewfinder}>
          <div className={styles.scanbox}>
            <div className="scan-corner scan-corner--tl" />
            <div className="scan-corner scan-corner--tr" />
            <div className="scan-corner scan-corner--bl" />
            <div className="scan-corner scan-corner--br" />

            <div className={`${styles.labelPlaceholder}${state === 'thinking' ? ` ${styles.thinking}` : ''}`}>
              <div className={`mono tiny caps ${styles.labelTitle}`}>Nutrition Facts</div>
              <div className={styles.labelDivider} />
              {LABEL_ROWS.map((t, i) => {
                const parts = t.split(/\s+/);
                const [head, ...rest] = parts;
                return (
                  <div key={i} className={`mono ${styles.labelRow}`}>
                    <span>{head}</span>
                    <span>{rest.join(' ')}</span>
                  </div>
                );
              })}
            </div>

            {state === 'thinking' && <div className={styles.sweep} />}
            {state === 'done' && (
              <div className={styles.doneCheck}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
            )}
          </div>
        </div>

        <div className={styles.bottom}>
          {state === 'aim' && (
            <>
              <div className={`mono tiny caps ${styles.aimHint}`}>
                Point camera at nutrition label
              </div>
              {error && (
                <div className={`mono tiny ${styles.errorText}`}>
                  {error} — try again
                </div>
              )}
              <button
                onClick={openPicker}
                className={styles.captureBtn}
                aria-label="Capture"
              >
                <div className={styles.captureInner} />
              </button>
            </>
          )}
          {state === 'thinking' && (
            <div className={`mono tiny caps ${styles.statusText}`}>
              Reading label<span className="dot-pulse">...</span>
            </div>
          )}
          {state === 'done' && (
            <div className={`mono tiny caps ${styles.statusText}`}>Got it</div>
          )}
        </div>
      </div>
    </>
  );
}
