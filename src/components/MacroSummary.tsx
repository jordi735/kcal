// Bottom macros summary — kcal headline, big kcal bar, 3 macro bars, action row

import { useMemo } from 'preact/hooks';
import { sumMacros, type EntryWithMacros, type Goals } from '../types';
import { MACRO_KEYS } from '../macros';
import { cssVars } from '../styles';
import { MacroBar } from './MacroBar';
import { CogIcon, PlusIcon, WeightIcon } from './Icon';
import styles from './MacroSummary.module.css';

type MacroSummaryProps = {
  entries: EntryWithMacros[];
  goals: Goals | null | undefined;
  onSettings: () => void;
  onWeights: () => void;
  onAdd: () => void;
};

export function MacroSummary({ entries, goals, onSettings, onWeights, onAdd }: MacroSummaryProps) {
  const totals = useMemo(() => sumMacros(entries), [entries]);

  const kcalLeft = goals == null ? 0 : Math.max(0, goals.kcal - totals.kcal);
  const kcalOver = goals != null && totals.kcal > goals.kcal;
  const kcalPct = goals != null && goals.kcal > 0 ? Math.min(100, (totals.kcal / goals.kcal) * 100) : 0;

  return (
    <div className={styles.dock}>
      <div className={styles.headline}>
        <div className={styles.kcalCol}>
          <span className={`mono tiny caps ${styles.kcalLabel}`}>
            {goals === undefined ? 'Loading goals…' : goals === null ? 'No goal recorded' : kcalOver ? 'Over budget' : 'Kcal remaining'}
          </span>
          <div className={styles.kcalRow}>
            <span className={`mono ${styles.kcalNum}${kcalOver ? ` ${styles.kcalNumOver}` : ''}`}>
              {goals == null ? '—' : <>{kcalOver ? '+' : ''}{Math.round(kcalOver ? totals.kcal - goals.kcal : kcalLeft)}</>}
            </span>
            {goals != null && <span className={`mono ${styles.kcalGoal}`}>/ {goals.kcal}</span>}
          </div>
        </div>
        <div className={styles.consumedCol}>
          <span className={`mono tiny caps ${styles.consumedLabel}`}>Consumed</span>
          <span className={`mono ${styles.consumedValue}`}>
            {Math.round(totals.kcal)} <span className={styles.consumedUnit}>kcal</span>
          </span>
        </div>
      </div>

      {goals != null && <div className={styles.kcalBar}>
        <div
          className={`${styles.kcalBarFill}${kcalOver ? ` ${styles.kcalBarFillOver}` : ''}`}
          style={cssVars({ '--kcal-pct': `${kcalPct}%` })}
        />
      </div>}

      <div className={styles.macroGrid}>
        {MACRO_KEYS.map((k) => (
          <MacroBar key={k} macroKey={k} consumed={totals[k]} goal={goals?.[k]} />
        ))}
      </div>

      <div className={styles.actions}>
        <button
          onClick={onSettings}
          className={styles.settingsBtn}
          aria-label="Settings"
        >
          <CogIcon size={18} />
        </button>
        <button
          onClick={onWeights}
          className={styles.settingsBtn}
          aria-label="Weights"
        >
          <WeightIcon size={19} />
        </button>
        <button onClick={onAdd} className={`btn-primary ${styles.addBtn}`}>
          <PlusIcon size={16} />
          ADD FOOD
        </button>
      </div>
    </div>
  );
}
