// Thin labelled macro bar — used in the bottom summary

import styles from './MacroBar.module.css';

export type MacroBarProps = {
  label: string;
  consumed: number;
  goal: number;
  unit?: string;
};

export function MacroBar({ label, consumed, goal, unit = 'g' }: MacroBarProps) {
  const ratio = goal > 0 ? consumed / goal : 0;
  const pct = Math.min(100, ratio * 100);
  const over = consumed > goal;
  const left = Math.max(0, goal - consumed);

  let barColor: string;
  if (over || ratio >= 1) barColor = '#fb4934';
  else if (ratio >= 2 / 3) barColor = '#fe8019';
  else if (ratio >= 1 / 3) barColor = '#fabd2f';
  else barColor = '#b8bb26';

  return (
    <div className={styles.bar}>
      <div className={styles.header}>
        <span className={`mono tiny caps ${styles.label}`}>{label}</span>
        <span className={`mono ${styles.value}${over ? ` ${styles.valueOver}` : ''}`}>
          {over ? `+${Math.round(consumed - goal)}` : Math.round(left)}
          <span className={styles.unit}>{unit}</span>
        </span>
      </div>
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={{
            ['--fill-pct' as any]: `${pct}%`,
            ['--bar-color' as any]: barColor,
          }}
        />
      </div>
    </div>
  );
}
