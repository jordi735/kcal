import { useEffect, useState, type Dispatch, type StateUpdater } from 'preact/hooks';
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

  const applyGoals = (saved: Goals) => {
    setGoals(saved);
    if (user !== null) {
      const updatedUser = userWithGoals(user, saved);
      localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
      setUser(updatedUser);
    }
  };

  return { user, setUser, goals, setGoals, applyGoals };
}

// Called after the entry-loading effects in App to preserve request ordering.
// Cached goals render immediately; GET /settings remains authoritative on boot
// and user changes. Goal-only updates do not trigger another revalidation.
export function useGoalRevalidation(
  user: User | null,
  setUser: Dispatch<StateUpdater<User | null>>,
  setGoals: Dispatch<StateUpdater<Goals>>,
) {
  useEffect(() => {
    if (user === null) return;
    let cancelled = false;
    void api<Goals>('/settings')
      .then((fresh) => {
        if (cancelled) return;
        setGoals(fresh);
        setUser((prev) => {
          if (prev === null) return prev;
          const updated = userWithGoals(prev, fresh);
          localStorage.setItem(USER_KEY, JSON.stringify(updated));
          return updated;
        });
      })
      .catch(() => {
        // api handles 401; other failures retain the cached values until the
        // next boot or save reconciles them.
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
}
