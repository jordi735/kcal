// Thin labelled macro bar — used in the bottom summary.

import { MACRO_META, type MacroKey } from '../macros';
import { cssVars } from '../styles';
import styles from './MacroBar.module.css';

type MacroBarProps = {
  macroKey: MacroKey;
  consumed: number;
  goal: number;
};

export function MacroBar({ macroKey, consumed, goal }: MacroBarProps) {
  const { short, color } = MACRO_META[macroKey];
  const ratio = goal > 0 ? consumed / goal : 0;
  const pct = Math.min(100, ratio * 100);
  const over = consumed > goal;
  const barColor = over ? 'var(--danger)' : color;

  return (
    <div className={styles.bar}>
      <div className={styles.header}>
        <span className={`mono tiny caps ${styles.label}`}>{short}</span>
        <span className={styles.valueBox}>
          <span className={`mono ${styles.current}${over ? ` ${styles.currentOver}` : ''}`}>
            {Math.round(consumed)}
          </span>
          <span className={`mono ${styles.goal}`}>/ {Math.round(goal)}</span>
        </span>
      </div>
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={cssVars({ '--fill-pct': `${pct}%`, '--bar-color': barColor })}
        />
      </div>
    </div>
  );
}
