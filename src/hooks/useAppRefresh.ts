import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

// A resumed page can receive visibility, focus and pageshow together. Group
// those signals into one refresh, without imposing a freshness cooldown on
// the next trip into the background.
const RESUME_DELAY_MS = 100;

export function useAppRefresh(
  userId: number | undefined,
  reportError: (message: string) => void,
) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const errorVersion = useRef<number | null>(null);

  useEffect(() => {
    if (userId === undefined) return;
    let timer: number | null = null;
    // Initial focus belongs to boot, which already loads the data.
    let focusNeedsRefresh = false;

    const cancel = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      if (document.visibilityState !== 'visible' || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (document.visibilityState === 'visible') {
          setRefreshVersion((version) => version + 1);
        }
      }, RESUME_DELAY_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        focusNeedsRefresh = true;
        cancel();
      } else if (document.visibilityState === 'visible') {
        focusNeedsRefresh = false;
        schedule();
      }
    };
    const onBlur = () => { focusNeedsRefresh = true; };
    const onFocus = () => {
      if (!focusNeedsRefresh) return;
      focusNeedsRefresh = false;
      schedule();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      focusNeedsRefresh = false;
      schedule();
    };
    const onPageHide = () => {
      focusNeedsRefresh = true;
      cancel();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', schedule);
    return () => {
      cancel();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', schedule);
    };
  }, [userId]);

  const onRefreshError = useCallback(() => {
    // All consumers share one notification per refresh, even when several
    // endpoints fail together while the device is reconnecting.
    if (errorVersion.current === refreshVersion) return;
    errorVersion.current = refreshVersion;
    reportError("Couldn't refresh data. Check your connection.");
  }, [refreshVersion, reportError]);

  return { refreshVersion, onRefreshError };
}
