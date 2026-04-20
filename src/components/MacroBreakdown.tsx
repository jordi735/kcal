// Colored P/C/F breakdown shared by FoodRow, SelectionBar, and AddPicker.

import type { Macros } from '../types';
import { MACRO_KEYS, MACRO_META } from '../macros';
import styles from './MacroBreakdown.module.css';

type MacroBreakdownProps = {
  macros: Macros;
  className?: string | undefined;
};

export function MacroBreakdown({ macros, className }: MacroBreakdownProps) {
  return (
    <span className={`mono ${styles.breakdown}${className ? ` ${className}` : ''}`}>
      {MACRO_KEYS.map((k) => (
        <span key={k} style={{ color: MACRO_META[k].color }}>
          {MACRO_META[k].short}{Math.round(macros[k])}
        </span>
      ))}
    </span>
  );
}
