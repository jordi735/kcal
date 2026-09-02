// Home screen — week strip, flat entry list, selection strip, bottom macro summary.

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { EntryGroup, EntryWithMacros, Goals, Macros } from '../types';
import { WeekStrip } from '../components/WeekStrip';
import { MacroSummary } from '../components/MacroSummary';
import { FoodRow } from '../components/FoodRow';
import { EntryGroupRow } from '../components/EntryGroupRow';
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
  onMarkTagged: (entries: EntryWithMacros[], tagged: boolean) => void;
  onCreateGroup: (entries: EntryWithMacros[]) => void;
  onMarkGroupTagged: (groupId: number, tagged: boolean) => void;
  onEditGroup: (group: EntryGroup) => void;
  selectionResetVersion: number;
  onOpenSettings: () => void;
  onOpenWeights: () => void;
};

type DayListItem =
  | { kind: 'entry'; entry: EntryWithMacros }
  | { kind: 'group'; group: EntryGroup; entries: EntryWithMacros[] };

function buildDayList(entries: EntryWithMacros[]): DayListItem[] {
  const byGroup = new Map<number, EntryWithMacros[]>();
  for (const entry of entries) {
    if (entry.group === null) continue;
    const members = byGroup.get(entry.group.id) ?? [];
    members.push(entry);
    byGroup.set(entry.group.id, members);
  }

  const seenGroups = new Set<number>();
  const result: DayListItem[] = [];
  for (const entry of entries) {
    if (entry.group === null) {
      result.push({ kind: 'entry', entry });
      continue;
    }
    if (seenGroups.has(entry.group.id)) continue;
    seenGroups.add(entry.group.id);
    result.push({
      kind: 'group',
      group: {
        id: entry.group.id,
        name: entry.group.name,
        local_date: entry.local_date,
      },
      entries: byGroup.get(entry.group.id) ?? [entry],
    });
  }
  return result;
}

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
  onMarkTagged,
  onCreateGroup,
  onMarkGroupTagged,
  onEditGroup,
  selectionResetVersion,
  onOpenSettings,
  onOpenWeights,
}: HomeProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<number>>(() => new Set());

  // Reset selection when the user navigates to a different day.
  useEffect(() => {
    setSelectedIds(new Set());
    setExpandedGroupIds(new Set());
  }, [selectedDate]);

  // Group creation owns its naming Sheet in App, while selection remains local
  // to Home. App bumps this only after a successful create.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectionResetVersion]);

  const selectionMode = selectedIds.size > 0;
  const selectedEntries = useMemo(
    () => entries.filter((e) => selectedIds.has(e.id)),
    [entries, selectedIds],
  );
  const dayList = useMemo(() => buildDayList(entries), [entries]);

  const toggleSelect = (entry: EntryWithMacros) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const toggleSelectMany = (members: EntryWithMacros[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = members.every((entry) => next.has(entry.id));
      for (const entry of members) {
        if (allSelected) next.delete(entry.id);
        else next.add(entry.id);
      }
      return next;
    });
  };

  const toggleExpanded = (groupId: number) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleDelete = () => {
    onDeleteEntries(selectedEntries);
    setSelectedIds(new Set());
  };

  const handleToggleTagged = (tagged: boolean) => {
    onMarkTagged(selectedEntries, tagged);
    setSelectedIds(new Set());
  };

  const canGroup =
    selectedEntries.length >= 2 && selectedEntries.every((entry) => entry.group === null);

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
            {dayList.map((item) => {
              if (item.kind === 'entry') {
                const entry = item.entry;
                return (
                  <FoodRow
                    key={entry.id}
                    entry={entry}
                    selected={selectedIds.has(entry.id)}
                    selectionMode={selectionMode}
                    onEdit={onEditEntry}
                    onToggleSelect={toggleSelect}
                    onToggleTagged={(en) => onMarkTagged([en], !en.tagged)}
                    onLongPress={toggleSelect}
                  />
                );
              }

              const expanded = expandedGroupIds.has(item.group.id);
              const allSelected = item.entries.every((entry) => selectedIds.has(entry.id));
              return (
                <div key={`group-${item.group.id}`} className={styles.groupBlock}>
                  <EntryGroupRow
                    group={item.group}
                    entries={item.entries}
                    expanded={expanded}
                    selected={allSelected}
                    selectionMode={selectionMode}
                    onToggleExpanded={() => toggleExpanded(item.group.id)}
                    onToggleSelect={() => toggleSelectMany(item.entries)}
                    onToggleTagged={(tagged) => onMarkGroupTagged(item.group.id, tagged)}
                    onEdit={() => onEditGroup(item.group)}
                  />
                  {expanded && (
                    <div className={styles.groupChildren}>
                      {item.entries.map((entry) => (
                        <FoodRow
                          key={entry.id}
                          entry={entry}
                          selected={selectedIds.has(entry.id)}
                          selectionMode={selectionMode}
                          onEdit={onEditEntry}
                          onToggleSelect={toggleSelect}
                          onToggleTagged={(en) => onMarkTagged([en], !en.tagged)}
                          onLongPress={toggleSelect}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <SelectionBar
        visible={selectionMode}
        selected={selectedEntries}
        onClear={clearSelection}
        onDelete={handleDelete}
        onToggleTagged={handleToggleTagged}
        canGroup={canGroup}
        onGroup={() => onCreateGroup(selectedEntries)}
      />

      <MacroSummary
        entries={entries}
        goals={goals}
        onSettings={onOpenSettings}
        onWeights={onOpenWeights}
        onAdd={onAddEntry}
      />
    </div>
  );
}
