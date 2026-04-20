// Bottom macros summary — kcal headline, big kcal bar, 3 macro bars, action row

import { useMemo } from 'preact/hooks';
import { sumMacros, type EntryWithMacros, type Goals } from '../types';
import { MacroBar } from './MacroBar';
import { CogIcon, PlusIcon } from './Icon';
import styles from './MacroSummary.module.css';

type MacroSummaryProps = {
  entries: EntryWithMacros[];
  goals: Goals;
  onSettings: () => void;
  onAdd: () => void;
};

export function MacroSummary({ entries, goals, onSettings, onAdd }: MacroSummaryProps) {
  const totals = useMemo(() => sumMacros(entries), [entries]);

  const kcalLeft = Math.max(0, goals.kcal - totals.kcal);
  const kcalOver = totals.kcal > goals.kcal;
  const kcalPct = goals.kcal > 0 ? Math.min(100, (totals.kcal / goals.kcal) * 100) : 0;

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
          <CogIcon size={18} />
        </button>
        <button onClick={onAdd} className={`btn-primary ${styles.addBtn}`}>
          <PlusIcon size={16} />
          ADD FOOD
        </button>
      </div>
    </div>
  );
}
