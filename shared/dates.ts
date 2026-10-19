import { isLocalDate } from './constraints.js';

const DAY_MS = 86_400_000;

export function datesFromStart(start: string, count: number): string[] {
  if (!isLocalDate(start) || !Number.isInteger(count) || count < 1) throw new RangeError('invalid_date_range');
  const first = Date.parse(`${start}T00:00:00Z`);
  const dates = Array.from({ length: count }, (_, i) => new Date(first + i * DAY_MS).toISOString().slice(0, 10));
  if (dates.some((date) => !isLocalDate(date))) throw new RangeError('date_outside_supported_range');
  return dates;
}

export function rangeDates(start: string, end: string, maxDays: number): string[] {
  if (!isLocalDate(start) || !isLocalDate(end) || start > end) throw new RangeError('invalid_date_range');
  const count = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS + 1;
  if (count > maxDays) throw new RangeError(`date_range_exceeds_${maxDays}_days`);
  return datesFromStart(start, count);
}

export function weekDates(value: string): string[] {
  if (!isLocalDate(value)) throw new RangeError('invalid_date');
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  try {
    return datesFromStart(date.toISOString().slice(0, 10), 7);
  } catch {
    throw new RangeError('week_outside_supported_date_range');
  }
}
