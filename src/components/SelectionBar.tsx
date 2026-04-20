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
import { TrashIcon, XMarkIcon } from './Icon';
import styles from './SelectionBar.module.css';

type SelectionBarProps = {
  visible: boolean;
  selected: EntryWithMacros[];
  onClear: () => void;
  onDelete: () => void;
};

export function SelectionBar({ visible, selected, onClear, onDelete }: SelectionBarProps) {
  const [render, setRender] = useState(visible);
  const [exiting, setExiting] = useState(false);
  const lastSelectedRef = useRef(selected);
  if (visible) lastSelectedRef.current = selected;

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

  return (
    <div className={`${styles.bar}${exiting ? ` ${styles.exiting}` : ''}`}>
      <div className={styles.count}>
        <span className={`mono tiny caps ${styles.countLabel}`}>{n} selected</span>
        <div className={styles.totals}>
          <span className={`mono ${styles.kcal}`}>{Math.round(totals.kcal)}</span>
          <span className={`mono ${styles.kcalUnit}`}>kcal</span>
          <span className={`mono ${styles.macros}`}>
            P{Math.round(totals.protein)} C{Math.round(totals.carbs)} F{Math.round(totals.fat)}
          </span>
        </div>
      </div>
      <div className={styles.actions}>
        <button
          onClick={onDelete}
          className={`mono ${styles.deleteBtn}`}
          aria-label={`Delete ${n} selected`}
        >
          <TrashIcon size={14} />
          {n}
        </button>
        <button
          onClick={onClear}
          className={`mono ${styles.clearBtn}`}
          aria-label="Clear selection"
        >
          <XMarkIcon size={14} />
          Cancel
        </button>
      </div>
    </div>
  );
}
