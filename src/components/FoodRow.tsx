// Food entry row — tap to edit, long-press to enter multi-select.

import type { EntryWithMacros } from '../types';
import { MacroBreakdown } from './MacroBreakdown';
import styles from './FoodRow.module.css';

type FoodRowProps = {
  entry: EntryWithMacros;
  selected: boolean;
  selectionMode: boolean;
  onEdit: (entry: EntryWithMacros) => void;
  onToggleSelect: (entry: EntryWithMacros) => void;
  onLongPress: (entry: EntryWithMacros) => void;
};

export function FoodRow({
  entry,
  selected,
  selectionMode,
  onEdit,
  onToggleSelect,
  onLongPress,
}: FoodRowProps) {
  const { product, macros, grams, local_time } = entry;

  return (
    <div className={`food-row ${styles.row}${selected ? ` ${styles.selected}` : ''}`}>
      <button
        onClick={() => {
          if (selectionMode) onToggleSelect(entry);
          else onEdit(entry);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onLongPress(entry);
        }}
        className={styles.main}
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
          <MacroBreakdown macros={macros} />
        </div>
      </button>
    </div>
  );
}
