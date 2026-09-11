import { SESSION_TOKEN_KEY, USER_KEY } from './api';
import type { Goals, User } from './types';

export function readStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function readStoredToken(): string | null {
  const raw = localStorage.getItem(SESSION_TOKEN_KEY);
  if (raw === null || raw === '') return null;
  return raw;
}

export function userToGoals(user: User): Goals {
  return {
    kcal: user.goal_kcal,
    protein: user.goal_protein,
    carbs: user.goal_carbs,
    fat: user.goal_fat,
  };
}

export function userWithGoals(user: User, goals: Goals): User {
  return {
    ...user,
    goal_kcal: goals.kcal,
    goal_protein: goals.protein,
    goal_carbs: goals.carbs,
    goal_fat: goals.fat,
  };
}
