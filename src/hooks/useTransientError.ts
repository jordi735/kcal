import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { FADE_EXIT_MS } from './useFadeClose';

export function useTransientError() {
  const [transientError, setTransientError] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);

  // A new error cancels both timers from the previous toast, including a fade
  // that has already started, so each message receives its full display time.
  const errorTimersRef = useRef<{ outer: number | null; inner: number | null }>({
    outer: null,
    inner: null,
  });

  const reportError = useCallback((msg: string) => {
    if (errorTimersRef.current.outer !== null) {
      window.clearTimeout(errorTimersRef.current.outer);
      errorTimersRef.current.outer = null;
    }
    if (errorTimersRef.current.inner !== null) {
      window.clearTimeout(errorTimersRef.current.inner);
      errorTimersRef.current.inner = null;
    }
    setTransientError(msg);
    setErrorExiting(false);
    errorTimersRef.current.outer = window.setTimeout(() => {
      setErrorExiting(true);
      errorTimersRef.current.inner = window.setTimeout(() => {
        setTransientError((cur) => (cur === msg ? null : cur));
        setErrorExiting(false);
      }, FADE_EXIT_MS);
    }, 3750);
  }, []);

  useEffect(() => () => {
    if (errorTimersRef.current.outer !== null) window.clearTimeout(errorTimersRef.current.outer);
    if (errorTimersRef.current.inner !== null) window.clearTimeout(errorTimersRef.current.inner);
  }, []);

  return { transientError, errorExiting, reportError };
}
