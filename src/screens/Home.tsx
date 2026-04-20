// Home screen — week strip, flat entry list, selection strip, bottom macro summary.

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { EntryWithMacros, Goals, Macros } from '../types';
import { WeekStrip } from '../components/WeekStrip';
import { MacroSummary } from '../components/MacroSummary';
import { FoodRow } from '../components/FoodRow';
import { SelectionBar } from '../components/SelectionBar';
import { PlusIcon } from '../components/Icon';
import styles from './Home.module.css';

type HomeProps = {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  weekStart: Date;
  onChangeWeek: (monday: Date) => void;
  entries: EntryWithMacros[];
  loaded: boolean;
  totalsByDate: Record<string, Macros>;
  goals: Goals;
  onAddEntry: () => void;
  onEditEntry: (entry: EntryWithMacros) => void;
  onDeleteEntries: (entries: EntryWithMacros[]) => void;
  onOpenSettings: () => void;
};

export function Home({
  selectedDate,
  onSelectDate,
  weekStart,
  onChangeWeek,
  entries,
  loaded,
  totalsByDate,
  goals,
  onAddEntry,
  onEditEntry,
  onDeleteEntries,
  onOpenSettings,
}: HomeProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  // Reset selection when the user navigates to a different day.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectedDate]);

  const selectionMode = selectedIds.size > 0;
  const selectedEntries = useMemo(
    () => entries.filter((e) => selectedIds.has(e.id)),
    [entries, selectedIds],
  );

  const toggleSelect = (entry: EntryWithMacros) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleDelete = () => {
    onDeleteEntries(selectedEntries);
    setSelectedIds(new Set());
  };

  return (
    <div className={styles.shell}>
      <WeekStrip
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        weekStart={weekStart}
        onChangeWeek={onChangeWeek}
        totalsByDate={totalsByDate}
        goalKcal={goals.kcal}
      />

      <div className={`no-scroll ${styles.list}`}>
        {entries.length === 0 && !loaded ? (
          <div className={`mono tiny caps ${styles.loading}`}>Loading...</div>
        ) : entries.length === 0 ? (
          <button type="button" onClick={onAddEntry} className={styles.emptyBtn}>
            <div className={styles.plusIcon}>
              <PlusIcon size={20} />
            </div>
            <div className={`mono caps ${styles.emptyLabel}`}>No food logged</div>
            <div className={styles.emptyHint}>
              Tap here to log your first item of the day.
            </div>
          </button>
        ) : (
          <div>
            {entries.map((e) => (
              <FoodRow
                key={e.id}
                entry={e}
                selected={selectedIds.has(e.id)}
                selectionMode={selectionMode}
                onEdit={onEditEntry}
                onToggleSelect={toggleSelect}
                onLongPress={toggleSelect}
              />
            ))}
          </div>
        )}
      </div>

      <SelectionBar
        visible={selectionMode}
        selected={selectedEntries}
        onClear={clearSelection}
        onDelete={handleDelete}
      />

      <MacroSummary
        entries={entries}
        goals={goals}
        onSettings={onOpenSettings}
        onAdd={onAddEntry}
      />
    </div>
  );
}
