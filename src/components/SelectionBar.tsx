// Appears above the daily MacroSummary dock when rows are selected.
// Shows combined macros for the selection and exposes clear + delete.
//
// Self-manages its own exit animation: the parent toggles `visible`, and when
// visible flips to false the bar stays mounted for FADE_EXIT_MS while the
// slideDown keyframe runs. During exit the last non-empty selection is shown
// from a ref so the counts don't flash to zero as they animate out.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { sumMacros, type EntryWithMacros } from '../types';
import { FADE_EXIT_MS } from '../hooks/useFadeClose';
import { MacroBreakdown } from './MacroBreakdown';
import { CheckCircleIcon, TrashIcon, XMarkIcon } from './Icon';
import styles from './SelectionBar.module.css';

type SelectionBarProps = {
  visible: boolean;
  selected: EntryWithMacros[];
  onClear: () => void;
  onDelete: () => void;
  onToggleTagged: (tagged: boolean) => void;
};

export function SelectionBar({
  visible,
  selected,
  onClear,
  onDelete,
  onToggleTagged,
}: SelectionBarProps) {
  const [render, setRender] = useState(visible);
  const [exiting, setExiting] = useState(false);
  const lastSelectedRef = useRef(selected);
  if (visible) lastSelectedRef.current = selected;

  // Entry: a CSS @keyframes animation on .bar fires on mount — the element
  // remounts whenever `render` flips back to true, so the animation runs
  // each time the bar appears. Exit: add `exiting` to trigger a transform
  // transition, stay mounted for FADE_EXIT_MS while the slide out plays.
  useEffect(() => {
    if (visible) {
      setRender(true);
      setExiting(false);
      return;
    }
    if (!render) return;
    setExiting(true);
    const t = window.setTimeout(() => {
      setRender(false);
      setExiting(false);
    }, FADE_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [visible, render]);

  const shown = visible ? selected : lastSelectedRef.current;
  const totals = useMemo(() => sumMacros(shown), [shown]);

  if (!render) return null;

  const n = shown.length;
  const allTagged = n > 0 && shown.every((e) => e.tagged);

  return (
    <div className={`${styles.bar}${exiting ? ` ${styles.exiting}` : ''}`}>
      <div className={styles.count}>
        <span className={`mono tiny caps ${styles.countLabel}`}>{n} selected</span>
        <div className={styles.totals}>
          <span className={`mono ${styles.kcal}`}>{Math.round(totals.kcal)}</span>
          <span className={`mono ${styles.kcalUnit}`}>kcal</span>
          <MacroBreakdown macros={totals} className={styles.macrosOffset} />
        </div>
      </div>
      <div className={styles.actions}>
        <button
          onClick={onDelete}
          className={styles.deleteBtn}
          aria-label={`Delete ${n} selected`}
        >
          <TrashIcon size={14} />
        </button>
        <button
          onClick={() => onToggleTagged(!allTagged)}
          className={styles.tagBtn}
          aria-label={allTagged ? `Untag ${n} selected` : `Tag ${n} selected`}
        >
          <CheckCircleIcon size={14} />
        </button>
        <button
          onClick={onClear}
          className={styles.clearBtn}
          aria-label="Clear selection"
        >
          <XMarkIcon size={14} />
        </button>
      </div>
    </div>
  );
}
