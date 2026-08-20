// Collapsible parent row for a day-scoped entry group. Macros and eaten state
// are always derived from its real child entries.

import { useMemo } from 'preact/hooks';
import { sumMacros, type EntryGroup, type EntryWithMacros } from '../types';
import { MacroBreakdown } from './MacroBreakdown';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleIcon,
  MinusCircleIcon,
  PencilIcon,
} from './Icon';
import styles from './EntryGroupRow.module.css';

type EntryGroupRowProps = {
  group: EntryGroup;
  entries: EntryWithMacros[];
  expanded: boolean;
  selected: boolean;
  selectionMode: boolean;
  onToggleExpanded: () => void;
  onToggleSelect: () => void;
  onToggleTagged: (tagged: boolean) => void;
  onEdit: () => void;
};

export function EntryGroupRow({
  group,
  entries,
  expanded,
  selected,
  selectionMode,
  onToggleExpanded,
  onToggleSelect,
  onToggleTagged,
  onEdit,
}: EntryGroupRowProps) {
  const macros = useMemo(() => sumMacros(entries), [entries]);
  const allTagged = entries.length > 0 && entries.every((entry) => entry.tagged);
  const someTagged = entries.some((entry) => entry.tagged);
  const pressed: boolean | 'mixed' = allTagged ? true : someTagged ? 'mixed' : false;

  return (
    <div className={`entry-group ${styles.row}${selected ? ` ${styles.selected}` : ''}`}>
      <button
        type="button"
        className={`${styles.dotBtn}${someTagged ? ` ${styles.dotActive}` : ''}`}
        onClick={() => onToggleTagged(!allTagged)}
        aria-label={allTagged ? `Mark ${group.name} as not eaten` : `Mark ${group.name} as eaten`}
        aria-pressed={pressed}
      >
        {allTagged ? (
          <CheckCircleIcon size={20} />
        ) : someTagged ? (
          <MinusCircleIcon size={20} />
        ) : (
          <CircleIcon size={20} />
        )}
      </button>

      <button
        type="button"
        className={styles.main}
        onClick={() => {
          if (selectionMode) onToggleSelect();
          else onToggleExpanded();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onToggleSelect();
        }}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.name}`}
        aria-expanded={expanded}
      >
        <div className={styles.info}>
          <div className={styles.name}>{group.name}</div>
          <div className={`mono ${styles.meta}`}>
            {entries.length} {entries.length === 1 ? 'item' : 'items'}
          </div>
        </div>
        <div className={styles.macros}>
          <div className={`mono ${styles.kcal}`}>{Math.round(macros.kcal)}</div>
          <MacroBreakdown macros={macros} />
        </div>
        <ArrowRightIcon
          size={14}
          className={`${styles.chevron}${expanded ? ` ${styles.chevronExpanded}` : ''}`}
        />
      </button>

      <button
        type="button"
        className={styles.editBtn}
        onClick={onEdit}
        aria-label={`Edit group ${group.name}`}
      >
        <PencilIcon size={14} />
      </button>
    </div>
  );
}
