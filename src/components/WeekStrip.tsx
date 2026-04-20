// Week strip: week number, prev/next, 7 day pills with dots for progress

import type { Macros } from '../types';
import {
  DAY_LETTERS,
  MONTH_NAMES,
  getWeekNumber,
  isSameDay,
  toLocalDateString,
  weekDays,
} from '../dates';
import { ArrowLeftIcon, ArrowRightIcon } from './Icon';
import styles from './WeekStrip.module.css';

type WeekStripProps = {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  weekStart: Date;
  onChangeWeek: (monday: Date) => void;
  totalsByDate: Record<string, Macros>;
  goalKcal: number;
};

type DayPillProps = {
  date: Date;
  dayLetter: string;
  isSelected: boolean;
  isToday: boolean;
  progress: number;
  onSelect: (d: Date) => void;
};

const cx = (...xs: (string | false | null | undefined)[]) =>
  xs.filter(Boolean).join(' ');

function DayPill({ date, dayLetter, isSelected, isToday, progress, onSelect }: DayPillProps) {
  const dotOpacity = progress > 0 ? Math.max(0.4, progress) : 0;

  return (
    <button
      onClick={() => onSelect(date)}
      className={cx(
        styles.pill,
        isToday && styles.today,
        isSelected && styles.selected,
        progress > 0 && styles.hasProgress,
        progress > 0.9 && styles.complete,
      )}
    >
      <span className={`mono tiny ${styles.dayLetter}`}>{dayLetter}</span>
      <span className={`mono ${styles.dayNum}`}>{date.getDate()}</span>
      <div
        className={styles.dot}
        style={{ ['--dot-opacity' as any]: dotOpacity }}
      />
    </button>
  );
}

export function WeekStrip({
  selectedDate,
  onSelectDate,
  weekStart,
  onChangeWeek,
  totalsByDate,
  goalKcal,
}: WeekStripProps) {
  const today = new Date();
  const days = weekDays(weekStart);
  const firstDay = days[0];
  const lastDay = days[6];
  if (!firstDay || !lastDay) {
    return null;
  }
  const weekNum = getWeekNumber(firstDay);
  const firstYear = firstDay.getFullYear();
  const lastYear = lastDay.getFullYear();

  const monthLabel = (() => {
    const firstMonthName = MONTH_NAMES[firstDay.getMonth()] ?? '';
    const lastMonthName = MONTH_NAMES[lastDay.getMonth()] ?? '';
    if (firstDay.getMonth() === lastDay.getMonth()) {
      return `${firstMonthName.slice(0, 3).toUpperCase()} ${firstYear}`;
    }
    if (firstYear !== lastYear) {
      return `${firstMonthName.slice(0, 3).toUpperCase()} ${firstYear}–${lastMonthName.slice(0, 3).toUpperCase()} ${lastYear}`;
    }
    return `${firstMonthName.slice(0, 3).toUpperCase()}–${lastMonthName.slice(0, 3).toUpperCase()} ${firstYear}`;
  })();

  const shiftWeek = (deltaWeeks: number) => {
    const next = new Date(weekStart);
    next.setDate(weekStart.getDate() + deltaWeeks * 7);
    onChangeWeek(next);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <button onClick={() => shiftWeek(-1)} className={styles.prevBtn}>
          <ArrowLeftIcon size={16} />
        </button>
        <div className={styles.headerCenter}>
          <span className={`mono tiny caps ${styles.monthLabel}`}>{monthLabel}</span>
          <span className={`mono caps ${styles.weekLabel}`}>
            Week {String(weekNum).padStart(2, '0')}
          </span>
        </div>
        <button onClick={() => shiftWeek(1)} className={styles.nextBtn}>
          <ArrowRightIcon size={16} />
        </button>
      </div>

      <div className={styles.days}>
        {days.map((d, i) => {
          const isSelected = isSameDay(d, selectedDate);
          const isToday = isSameDay(d, today);
          const totals = totalsByDate[toLocalDateString(d)];
          const progress = totals ? Math.min(1, totals.kcal / goalKcal) : 0;
          const dayLetter = DAY_LETTERS[i] ?? '';

          return (
            <DayPill
              key={toLocalDateString(d)}
              date={d}
              dayLetter={dayLetter}
              isSelected={isSelected}
              isToday={isToday}
              progress={progress}
              onSelect={onSelectDate}
            />
          );
        })}
      </div>
    </div>
  );
}
