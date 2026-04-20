// Barcode scanner modal — live camera viewfinder decoded by @zxing/browser.

import { useEffect, useRef, useState } from 'preact/hooks';
import { BrowserMultiFormatOneDReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useFadeClose } from '../hooks/useFadeClose';
import styles from './BarcodeScanner.module.css';

const FORMATS: readonly BarcodeFormat[] = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
];

type BarcodeScannerProps = {
  onDetect: (barcode: string) => void;
  onClose: () => void;
};

export function BarcodeScanner({ onDetect, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const firedRef = useRef(false);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { closing, requestClose } = useFadeClose(onClose);

  const closeNow = () => {
    if (controlsRef.current !== null) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }
    requestClose();
  };

  useEffect(() => {
    let cancelled = false;

    const video = videoRef.current;
    if (video === null) {
      return () => {
        cancelled = true;
      };
    }

    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
    const reader = new BrowserMultiFormatOneDReader(hints);

    reader
      .decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        video,
        (result, _err, controls) => {
          if (result === undefined) return;
          if (firedRef.current) return;
          firedRef.current = true;
          controls.stop();
          controlsRef.current = null;
          onDetectRef.current(result.getText());
        },
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setError('Camera access denied.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setError('No camera available.');
        } else {
          setError('Camera could not be started.');
        }
      });

    return () => {
      cancelled = true;
      if (controlsRef.current !== null) {
        controlsRef.current.stop();
        controlsRef.current = null;
      }
    };
  }, []);

  return (
    <>
      <div
        className={`overlay ${styles.overlayDark}${closing ? ' exiting' : ''}`}
        onClick={closeNow}
      />
      <div className={`${styles.shell}${closing ? ' fullscreen-exit' : ''}`}>
        <div className={styles.topbar}>
          <span className={`mono caps ${styles.topbarTitle}`}>SCAN BARCODE</span>
          <button onClick={closeNow} className={styles.closeBtn}>×</button>
        </div>

        <div className={styles.viewfinder}>
          {error === null && (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={styles.video}
            />
          )}
          {error === null ? (
            <div className={styles.scanbox}>
              <div className="scan-corner scan-corner--tl" />
              <div className="scan-corner scan-corner--tr" />
              <div className="scan-corner scan-corner--bl" />
              <div className="scan-corner scan-corner--br" />
              <div className={styles.scanline} />
            </div>
          ) : (
            <div className={styles.errorBox}>
              <div className={`mono tiny caps ${styles.errorTitle}`}>Scanner unavailable</div>
              <div className={styles.errorMsg}>{error}</div>
              <button
                onClick={closeNow}
                className={`mono tiny caps ${styles.errorCloseBtn}`}
              >
                Close
              </button>
            </div>
          )}
        </div>

        {error === null && (
          <div className={styles.bottom}>
            <div className={`mono tiny caps ${styles.bottomLabel}`}>Searching...</div>
            Point camera at the barcode.<br />Auto-detects.
          </div>
        )}
      </div>
    </>
  );
}
