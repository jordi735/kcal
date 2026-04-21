import { useEffect, useRef } from 'preact/hooks';

// Singleton state: the browser has one history stack, so the sentinel that
// represents "a modal is open" is a module-level singleton rather than
// per-hook-instance state.
let sentinelOnStack = false;
let activeRequestClose: (() => void) | null = null;
let pendingPop = false;
let listenerInstalled = false;

type SentinelState = { kcalModalTrap?: true } | null;

function ensureListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  window.addEventListener('popstate', () => {
    if (!sentinelOnStack) return;
    sentinelOnStack = false;
    activeRequestClose?.();
  });
}

export function useBackClose(requestClose: () => void) {
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    ensureListener();

    // Cancel a pop scheduled by a previous instance that unmounted in the
    // same commit — this is how modal→modal transitions keep a single
    // sentinel alive across the swap.
    pendingPop = false;

    if (!sentinelOnStack) {
      history.pushState({ kcalModalTrap: true }, '');
      sentinelOnStack = true;
    }

    const invoke = () => requestCloseRef.current();
    activeRequestClose = invoke;

    return () => {
      if (activeRequestClose === invoke) activeRequestClose = null;
      pendingPop = true;
      queueMicrotask(() => {
        if (!pendingPop) return;
        pendingPop = false;
        if (sentinelOnStack && (history.state as SentinelState)?.kcalModalTrap === true) {
          history.back();
          sentinelOnStack = false;
        }
      });
    };
  }, []);
}
