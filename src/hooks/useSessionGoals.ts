import { useEffect, useRef, useState, type Dispatch, type StateUpdater } from 'preact/hooks';
import { api, USER_KEY } from '../api';
import { DEFAULT_GOALS } from '../defaults';
import { readStoredToken, readStoredUser, userToGoals, userWithGoals } from '../session';
import type { Goals, User } from '../types';

export function useSessionGoals() {
  const initialToken = readStoredToken();
  const initialUser = readStoredUser();
  const bootedLoggedIn = initialToken !== null && initialUser !== null;

  const [user, setUser] = useState<User | null>(bootedLoggedIn ? initialUser : null);
  const [goals, setGoals] = useState<Goals>(() =>
    initialUser !== null ? userToGoals(initialUser) : DEFAULT_GOALS,
  );
  const goalSaveVersion = useRef(0);

  const applyGoals = (saved: Goals) => {
    goalSaveVersion.current++;
    setGoals(saved);
    if (user !== null) {
      const updatedUser = userWithGoals(user, saved);
      localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
      setUser(updatedUser);
    }
  };

  return { user, setUser, goals, setGoals, applyGoals, goalSaveVersion };
}

// Called after the entry-loading effects in App to preserve request ordering.
// Cached goals render immediately; GET /settings remains authoritative on boot
// and foreground returns. Goal-only updates do not trigger another read.
export function useGoalRevalidation(
  user: User | null,
  setUser: Dispatch<StateUpdater<User | null>>,
  setGoals: Dispatch<StateUpdater<Goals>>,
  refreshVersion: number,
  goalSaveVersion: { current: number },
  onRefreshError: () => void,
) {
  useEffect(() => {
    if (user === null) return;
    let cancelled = false;
    const savedVersion = goalSaveVersion.current;
    void api<Goals>('/settings')
      .then((fresh) => {
        if (cancelled || savedVersion !== goalSaveVersion.current) return;
        setGoals(fresh);
        setUser((prev) => {
          if (prev === null || prev.id !== user.id) return prev;
          const updated = userWithGoals(prev, fresh);
          localStorage.setItem(USER_KEY, JSON.stringify(updated));
          return updated;
        });
      })
      .catch(() => {
        // api handles 401; retain cached values on other failures.
        if (!cancelled && savedVersion === goalSaveVersion.current) onRefreshError();
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, refreshVersion, goalSaveVersion, onRefreshError]);
}
