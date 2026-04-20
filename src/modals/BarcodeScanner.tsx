// Barcode scanner modal — live camera viewfinder + BarcodeDetector polling.

import { useEffect, useRef, useState } from 'preact/hooks';
import { useFadeClose } from '../hooks/useFadeClose';
import styles from './BarcodeScanner.module.css';

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}
type BarcodeDetectorConstructor = new (opts?: {
  formats?: string[];
}) => BarcodeDetectorInstance;
type BarcodeDetectorInstance = {
  detect: (
    source: CanvasImageSource,
  ) => Promise<Array<{ rawValue: string; format: string }>>;
};

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];
const POLL_MS = 300;

type BarcodeScannerProps = {
  onDetect: (barcode: string) => void;
  onClose: () => void;
};

export function BarcodeScanner({ onDetect, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const firedRef = useRef(false);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { closing, requestClose } = useFadeClose(onClose);

  const closeNow = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current !== null) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    requestClose();
  };

  useEffect(() => {
    let cancelled = false;

    const Ctor = window.BarcodeDetector;
    if (Ctor === undefined) {
      setError('Barcode scanning isn\u2019t supported on this browser.');
      return () => {
        cancelled = true;
      };
    }

    let detector: BarcodeDetectorInstance;
    try {
      detector = new Ctor({ formats: FORMATS });
    } catch {
      setError('Barcode scanning isn\u2019t supported on this browser.');
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setError('Camera access denied.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setError('No camera available.');
        } else {
          setError('Camera could not be started.');
        }
        return;
      }

      if (cancelled) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        return;
      }

      const video = videoRef.current;
      if (video === null) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        return;
      }
      video.srcObject = streamRef.current;
      try {
        await video.play();
      } catch {
        // Autoplay can reject on some browsers; muted+playsInline keeps it quiet.
      }

      if (cancelled) return;

      intervalRef.current = setInterval(async () => {
        if (firedRef.current) return;
        const el = videoRef.current;
        if (el === null || el.readyState < 2) return;
        try {
          const results = await detector.detect(el);
          const first = results[0];
          if (first !== undefined && !firedRef.current) {
            firedRef.current = true;
            onDetectRef.current(first.rawValue);
          }
        } catch {
          // Transient mid-frame errors are expected; keep polling.
        }
      }, POLL_MS);
    })();

    return () => {
      cancelled = true;
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (streamRef.current !== null) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
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
