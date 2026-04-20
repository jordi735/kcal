// Week strip: week number, prev/next, 7 day pills with dots for progress.
// A horizontal swipe past ~50px shifts the visible week (same as the
// prev/next arrows). Pointer events axis-lock on first move so a vertical
// gesture starting here doesn't hijack the food list's page scroll.

import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
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

const AXIS_LOCK_PX = 8;
const COMMIT_THRESHOLD_PX = 50;

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
  const daysRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({
    startX: 0,
    startY: 0,
    pointerId: -1,
    lock: null as 'x' | 'y' | null,
    active: false,
  });

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

  const resetDays = (animated: boolean) => {
    const el = daysRef.current;
    if (el === null) return;
    if (animated) {
      const onEnd = () => {
        el.removeEventListener('transitionend', onEnd);
        el.classList.remove('week-strip--snap');
      };
      el.addEventListener('transitionend', onEnd);
      el.classList.add('week-strip--snap');
    }
    el.style.transform = 'translateX(0)';
  };

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      lock: null,
      active: true,
    };
    // Cancel any in-flight snap so subsequent translate is 1:1 with the finger.
    daysRef.current?.classList.remove('week-strip--snap');
  };

  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.lock === null) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      drag.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.lock === 'x') {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
    if (drag.lock === 'x' && daysRef.current !== null) {
      daysRef.current.style.transform = `translateX(${dx}px)`;
    }
  };

  const onPointerEnd = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const dx = e.clientX - drag.startX;
    const lock = drag.lock;
    drag.active = false;
    drag.lock = null;
    if (lock !== 'x') return;
    if (Math.abs(dx) >= COMMIT_THRESHOLD_PX) {
      // Finger went left → slide forward in time (next week).
      resetDays(false);
      shiftWeek(dx < 0 ? 1 : -1);
    } else {
      resetDays(true);
    }
  };

  return (
    <div
      className={styles.wrap}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
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

      <div className={styles.days} ref={daysRef}>
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
