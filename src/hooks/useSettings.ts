import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api, assertSessionCurrent, isSessionCurrent, notifySessionChanged, USER_KEY, type SessionScope } from '../api';
import { createMutationQueue } from '../mutationQueue';
import { readStoredUser, userWithGoals } from '../session';
import type { Goals, SettingsSnapshot, User } from '../types';

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function useSettings(
  session: SessionScope, user: User, refreshVersion: number, onRefreshError: () => void,
) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [loadError, setLoadError] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const queue = useRef(createMutationQueue(session)).current;
  const mutationVersion = useRef(0);
  const readVersion = useRef(0);
  const appliedReadVersion = useRef(0);
  const reportRefreshError = useRef(onRefreshError);
  reportRefreshError.current = onRefreshError;

  const apply = useCallback((fresh: SettingsSnapshot) => {
    assertSessionCurrent(session);
    setSnapshot(fresh);
    setLoadError(false);
    const cached = readStoredUser();
    if (cached?.id === user.id) {
      localStorage.setItem(USER_KEY, JSON.stringify(userWithGoals(cached, fresh)));
      notifySessionChanged();
    }
  }, [session, user.id]);

  const acceptWriteSnapshot = useCallback(async (saved: SettingsSnapshot, read: number) => {
    if (read === appliedReadVersion.current) {
      apply(saved);
      return;
    }
    // A refresh completed while this write was in flight. Reconcile a
    // possibly older write snapshot without misreporting a committed save.
    const applied = appliedReadVersion.current;
    try {
      const fresh = await api<SettingsSnapshot>('/settings', { session });
      if (applied === appliedReadVersion.current) {
        // Reconciliation is authoritative at this boundary. A normal refresh
        // may have captured an older snapshot while this read was pending;
        // invalidate those pending reads before they can undo the result.
        readVersion.current++;
        appliedReadVersion.current++;
        apply(fresh);
      }
    } catch {
      if (isSessionCurrent(session)) reportRefreshError.current();
    }
  }, [session, apply]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    const read = ++readVersion.current;
    const mutation = mutationVersion.current;
    void api<SettingsSnapshot>('/settings', { session }).then(async (fresh) => {
      if (cancelled || read !== readVersion.current || mutation !== mutationVersion.current) return;
      if (fresh.goal_history.length === 0) {
        // No guessed historical baseline: the first authenticated app open
        // asks the server to record the existing values on today's local date.
        mutationVersion.current++;
        await queue(async () => {
          const applied = appliedReadVersion.current;
          const initialized = await api<SettingsSnapshot>('/settings/goal-history/initialize', {
            method: 'POST', body: { time_zone: localTimeZone() }, session,
          });
          mutationVersion.current++;
          await acceptWriteSnapshot(initialized, applied);
        });
      } else {
        appliedReadVersion.current++;
        apply(fresh);
      }
    }).catch(() => {
      if (!cancelled && isSessionCurrent(session) && read === readVersion.current) {
        setLoadError(true);
        reportRefreshError.current();
      }
    });
    return () => { cancelled = true; };
  }, [session, refreshVersion, retryVersion, queue, apply, acceptWriteSnapshot]);

  const retry = useCallback(() => setRetryVersion((version) => version + 1), []);

  const save = useCallback((goals: Goals): Promise<void> => {
    mutationVersion.current++;
    return queue(async () => {
      const read = appliedReadVersion.current;
      const saved = await api<SettingsSnapshot & { effective_date: string }>('/settings', {
        method: 'PUT', body: { ...goals, time_zone: localTimeZone() }, session,
      });
      mutationVersion.current++;
      await acceptWriteSnapshot(saved, read);
    });
  }, [session, queue, acceptWriteSnapshot]);

  const dismissNotice = useCallback((version: number): Promise<void> => {
    mutationVersion.current++;
    return queue(async () => {
      const result = await api<{ mcp_notice_version: number | null }>('/settings/mcp-notice/dismiss', {
        method: 'POST', body: { version }, session,
      });
      mutationVersion.current++;
      setSnapshot((current) => current === undefined || current.mcp_notice_version !== version
        ? current : { ...current, mcp_notice_version: result.mcp_notice_version });
    });
  }, [session, queue]);

  return { snapshot, loadError, retry, save, dismissNotice };
}
