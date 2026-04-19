// Bottom macros summary — kcal headline, big kcal bar, 3 macro bars, action row

import { useMemo } from 'preact/hooks';
import { sumMacros, type EntryWithMacros, type Goals } from '../types';
import { MacroBar } from './MacroBar';
import styles from './MacroSummary.module.css';

export type MacroSummaryProps = {
  entries: EntryWithMacros[];
  goals: Goals;
  onSettings: () => void;
  onAdd: () => void;
};

export function MacroSummary({ entries, goals, onSettings, onAdd }: MacroSummaryProps) {
  const totals = useMemo(() => sumMacros(entries), [entries]);

  const kcalLeft = Math.max(0, goals.kcal - totals.kcal);
  const kcalOver = totals.kcal > goals.kcal;
  const kcalPct = Math.min(100, (totals.kcal / goals.kcal) * 100);

  return (
    <div className={styles.dock}>
      <div className={styles.headline}>
        <div className={styles.kcalCol}>
          <span className={`mono tiny caps ${styles.kcalLabel}`}>
            {kcalOver ? 'Over budget' : 'Kcal remaining'}
          </span>
          <div className={styles.kcalRow}>
            <span className={`mono ${styles.kcalNum}${kcalOver ? ` ${styles.kcalNumOver}` : ''}`}>
              {kcalOver ? '+' : ''}{Math.round(kcalOver ? totals.kcal - goals.kcal : kcalLeft)}
            </span>
            <span className={`mono ${styles.kcalGoal}`}>/ {goals.kcal}</span>
          </div>
        </div>
        <div className={styles.consumedCol}>
          <span className={`mono tiny caps ${styles.consumedLabel}`}>Consumed</span>
          <span className={`mono ${styles.consumedValue}`}>
            {Math.round(totals.kcal)} <span className={styles.consumedUnit}>kcal</span>
          </span>
        </div>
      </div>

      <div className={styles.kcalBar}>
        <div
          className={`${styles.kcalBarFill}${kcalOver ? ` ${styles.kcalBarFillOver}` : ''}`}
          style={{ ['--kcal-pct' as any]: `${kcalPct}%` }}
        />
      </div>

      <div className={styles.macroGrid}>
        <MacroBar label="Protein" consumed={totals.protein} goal={goals.protein} />
        <MacroBar label="Carbs" consumed={totals.carbs} goal={goals.carbs} />
        <MacroBar label="Fat" consumed={totals.fat} goal={goals.fat} />
      </div>

      <div className={styles.actions}>
        <button
          onClick={onSettings}
          className={styles.settingsBtn}
          aria-label="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
        <button onClick={onAdd} className={`btn-primary ${styles.addBtn}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          ADD FOOD
        </button>
      </div>
    </div>
  );
}
