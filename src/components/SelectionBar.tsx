// Appears above the daily MacroSummary dock when rows are selected.
// Shows combined macros for the selection and exposes clear + delete.

import { useMemo } from 'preact/hooks';
import { sumMacros, type EntryWithMacros } from '../types';
import { TrashIcon, XMarkIcon } from './Icon';
import styles from './SelectionBar.module.css';

type SelectionBarProps = {
  selected: EntryWithMacros[];
  onClear: () => void;
  onDelete: () => void;
};

export function SelectionBar({ selected, onClear, onDelete }: SelectionBarProps) {
  const totals = useMemo(() => sumMacros(selected), [selected]);
  const n = selected.length;

  return (
    <div className={styles.bar}>
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
          onClick={onClear}
          className={styles.clearBtn}
          aria-label="Clear selection"
        >
          <XMarkIcon size={16} />
        </button>
        <button
          onClick={onDelete}
          className={`mono ${styles.deleteBtn}`}
          aria-label={`Delete ${n} selected`}
        >
          <TrashIcon size={14} />
          Delete {n}
        </button>
      </div>
    </div>
  );
}
