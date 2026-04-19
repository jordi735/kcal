// Food entry row — tap to edit, long-press / context-menu to reveal swipe delete

import { useState } from 'preact/hooks';
import type { EntryWithMacros } from '../types';
import styles from './FoodRow.module.css';

export type FoodRowProps = {
  entry: EntryWithMacros;
  onEdit: (entry: EntryWithMacros) => void;
  onDelete: (entry: EntryWithMacros) => void;
};

export function FoodRow({ entry, onEdit, onDelete }: FoodRowProps) {
  const [swipe, setSwipe] = useState(false);
  const { product, macros, grams, local_time } = entry;

  return (
    <div className={`food-row ${styles.row}`}>
      {swipe && (
        <button
          onClick={() => {
            onDelete(entry);
            setSwipe(false);
          }}
          className={styles.deleteBtn}
        >
          DELETE
        </button>
      )}
      <button
        onClick={() => onEdit(entry)}
        onContextMenu={(e) => {
          e.preventDefault();
          setSwipe((s) => !s);
        }}
        className={`${styles.main}${swipe ? ` ${styles.swiping}` : ''}`}
      >
        <div className={styles.info}>
          <div className={styles.name}>
            {product.name}
            {product.is_temp && (
              <span className={`mono tiny caps ${styles.tmpBadge}`}>TMP</span>
            )}
          </div>
          <div className={`mono ${styles.meta}`}>
            <span>{grams}{product.unit}</span>
            {product.brand && <span className={styles.metaDim}>· {product.brand}</span>}
            <span className={styles.metaDim}>· {local_time}</span>
          </div>
        </div>
        <div className={styles.macros}>
          <div className={`mono ${styles.kcal}`}>{Math.round(macros.kcal)}</div>
          <div className={`mono ${styles.macroBreakdown}`}>
            <span>P{Math.round(macros.protein)}</span>
            <span>C{Math.round(macros.carbs)}</span>
            <span>F{Math.round(macros.fat)}</span>
          </div>
        </div>
      </button>
    </div>
  );
}
