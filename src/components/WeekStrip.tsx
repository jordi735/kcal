// Week strip: week number, prev/next, 7 day pills with dots for progress.
// Layout is a 3-week carousel track (prev / current / next) inside .days,
// so a horizontal swipe reveals neighbors 1:1 and commits animate the
// neighbor fully into view before state swaps. Pointer events axis-lock
// on first move so vertical gestures pass through to page scroll.

import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { Macros } from '../types';
import { cssVars } from '../styles';
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

// Track has 3 grids, each 1/3 of track width. -33.333% centers the
// current week in the viewport; -66.666% slides to next, 0% to prev.
const TRACK_CENTER = 'translateX(-33.333%)';
const TRACK_NEXT = 'translateX(-66.666%)';
const TRACK_PREV = 'translateX(0%)';

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

type WeekGridProps = {
  monday: Date;
  selectedDate: Date;
  today: Date;
  totalsByDate: Record<string, Macros>;
  goalKcal: number;
  onSelect: (d: Date) => void;
};

const cx = (...xs: (string | false | null | undefined)[]) =>
  xs.filter(Boolean).join(' ');

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(d.getDate() + n);
  return out;
}

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
        style={cssVars({ '--dot-opacity': dotOpacity })}
      />
    </button>
  );
}

function WeekGrid({
  monday,
  selectedDate,
  today,
  totalsByDate,
  goalKcal,
  onSelect,
}: WeekGridProps) {
  const days = weekDays(monday);
  return (
    <div className={styles.weekGrid}>
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
            onSelect={onSelect}
          />
        );
      })}
    </div>
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
  const trackRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const animatingRef = useRef(false);
  const commitEndRef = useRef<(() => void) | null>(null);
  const dragRef = useRef({
    startX: 0,
    startY: 0,
    pointerId: -1,
    viewportWidth: 0,
    lock: null as 'x' | 'y' | null,
    active: false,
  });

  // After weekStart changes (from an arrow click OR a committed swipe),
  // snap the track back to center synchronously — before paint — so the
  // newly-rendered middle grid lands in the viewport without a one-frame
  // flash of the wrong grid at the old committed position.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track === null) return;
    if (commitEndRef.current !== null) {
      track.removeEventListener('transitionend', commitEndRef.current);
      commitEndRef.current = null;
    }
    track.classList.remove('week-strip--snap');
    track.style.transform = TRACK_CENTER;
    animatingRef.current = false;
  }, [weekStart]);

  const today = new Date();
  const firstDay = weekStart;
  const lastDay = addDays(weekStart, 6);
  const prevMonday = addDays(weekStart, -7);
  const nextMonday = addDays(weekStart, 7);
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

  const snapTrackBack = () => {
    const track = trackRef.current;
    if (track === null) return;
    const onEnd = () => {
      track.removeEventListener('transitionend', onEnd);
      track.classList.remove('week-strip--snap');
    };
    track.addEventListener('transitionend', onEnd);
    track.classList.add('week-strip--snap');
    track.style.transform = TRACK_CENTER;
  };

  const commitTrack = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (track === null) return;
    // Remove any previous pending commit listener so it can't double-fire
    // if a transitionend from a prior (non-interrupted) animation lands late.
    if (commitEndRef.current !== null) {
      track.removeEventListener('transitionend', commitEndRef.current);
    }
    animatingRef.current = true;
    const onEnd = () => {
      track.removeEventListener('transitionend', onEnd);
      if (commitEndRef.current === onEnd) commitEndRef.current = null;
      // useLayoutEffect clears the snap class, resets transform to
      // TRACK_CENTER, and flips animatingRef off in the same render.
      shiftWeek(direction);
    };
    commitEndRef.current = onEnd;
    track.addEventListener('transitionend', onEnd);
    track.classList.add('week-strip--snap');
    track.style.transform = direction === 1 ? TRACK_NEXT : TRACK_PREV;
  };

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (animatingRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const viewportWidth = viewportRef.current?.clientWidth ?? 0;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      viewportWidth,
      lock: null,
      active: true,
    };
    // Cancel any in-flight snap so the next translate is 1:1 with the finger.
    trackRef.current?.classList.remove('week-strip--snap');
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
    if (drag.lock === 'x' && trackRef.current !== null) {
      const w = drag.viewportWidth;
      // Clamp to ±viewportWidth so the drag can't pan past the rendered
      // neighbors into empty space.
      const clamped = w > 0 ? Math.max(-w, Math.min(w, dx)) : dx;
      trackRef.current.style.transform = `translateX(calc(-33.333% + ${clamped}px))`;
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
      commitTrack(dx < 0 ? 1 : -1);
    } else {
      snapTrackBack();
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
      <div className={`mono tiny caps ${styles.caption}`}>
        {monthLabel} · W{String(weekNum).padStart(2, '0')}
      </div>

      <div className={styles.row}>
        <button onClick={() => shiftWeek(-1)} className={styles.prevBtn}>
          <ArrowLeftIcon size={16} />
        </button>
        <div className={styles.days} ref={viewportRef}>
          <div className={styles.track} ref={trackRef}>
            <WeekGrid
              monday={prevMonday}
              selectedDate={selectedDate}
              today={today}
              totalsByDate={totalsByDate}
              goalKcal={goalKcal}
              onSelect={onSelectDate}
            />
            <WeekGrid
              monday={weekStart}
              selectedDate={selectedDate}
              today={today}
              totalsByDate={totalsByDate}
              goalKcal={goalKcal}
              onSelect={onSelectDate}
            />
            <WeekGrid
              monday={nextMonday}
              selectedDate={selectedDate}
              today={today}
              totalsByDate={totalsByDate}
              goalKcal={goalKcal}
              onSelect={onSelectDate}
            />
          </div>
        </div>
        <button onClick={() => shiftWeek(1)} className={styles.nextBtn}>
          <ArrowRightIcon size={16} />
        </button>
      </div>
    </div>
  );
}
