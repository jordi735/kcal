// Home screen — week strip, flat entry list, bottom macro summary

import type { EntryWithMacros, Goals, Macros } from '../types';
import { WeekStrip } from '../components/WeekStrip';
import { MacroSummary } from '../components/MacroSummary';
import { FoodRow } from '../components/FoodRow';
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
  onDeleteEntry: (entry: EntryWithMacros) => void;
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
  onDeleteEntry,
  onOpenSettings,
}: HomeProps) {
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
                onEdit={onEditEntry}
                onDelete={onDeleteEntry}
              />
            ))}
          </div>
        )}
      </div>

      <MacroSummary
        entries={entries}
        goals={goals}
        onSettings={onOpenSettings}
        onAdd={onAddEntry}
      />
    </div>
  );
}
