import { useEffect, useState } from 'preact/hooks';
import { captureSession, SESSION_CHANGED_EVENT, SESSION_TOKEN_KEY, USER_KEY, type SessionScope } from '../api';
import { readStoredUser } from '../session';
import type { User } from '../types';

export type AuthenticatedSession = { scope: SessionScope; user: User };

function readSession(): AuthenticatedSession | null {
  const scope = captureSession();
  const user = readStoredUser();
  return scope.token !== null && user !== null ? { scope, user } : null;
}

// Tracker is keyed by generation, so every login/logout (including another tab)
// discards account-owned data, queued work, selections, and open forms together.
export function useSessionState(): AuthenticatedSession | null {
  const [session, setSession] = useState(readSession);
  useEffect(() => {
    const refresh = () => setSession(readSession());
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key === SESSION_TOKEN_KEY || event.key === USER_KEY) refresh();
    };
    window.addEventListener(SESSION_CHANGED_EVENT, refresh);
    window.addEventListener('storage', storage);
    refresh();
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', storage);
    };
  }, []);
  return session;
}
