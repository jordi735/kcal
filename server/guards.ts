// Shared body-validator primitives. Route-specific `isXxxBody` guards stay
// colocated with their routes — they describe what the route accepts — but
// every one of them starts from the same object/number/regex checks here.

export const EMAIL_RE = /\S+@\S+\.\S+/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^\d{2}:\d{2}$/;
export const LOGIN_CODE_RE = /^\d{6}$/;

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

export function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
