import { useEffect, useState } from 'preact/hooks';
import type { Goals } from '../types';
import { MACRO_KEYS, MACRO_META, type MacroKey } from '../macros';
import { cssVars } from '../styles';
import { Sheet, useSheetClose } from '../components/Sheet';
import { ArrowLeftIcon, MinusIcon, PlusIcon } from '../components/Icon';
import styles from './Settings.module.css';

type SettingsProps = {
  goals: Goals;
  onSave: (goals: Goals) => Promise<void>;
  onClose: () => void;
  onLogout: () => void;
  userEmail: string | null;
};

export function Settings(props: SettingsProps) {
  return (
    <Sheet onClose={props.onClose} style={cssVars({ '--sheet-height': '92%' })}>
      <SettingsInner {...props} />
    </Sheet>
  );
}

type InnerProps = Omit<SettingsProps, 'onClose'>;

type GoalFieldProps = {
  label: string;
  value: number;
  onChange: (n: number) => void;
  macroKey?: MacroKey;
  suffix?: string;
  step?: number;
  isLast?: boolean;
};

function GoalField({ label, value, onChange, macroKey, suffix = 'g', step = 5, isLast = false }: GoalFieldProps) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const color = macroKey !== undefined ? MACRO_META[macroKey].color : undefined;

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  return (
    <div
      className={`${styles.field}${isLast ? ` ${styles.fieldLast}` : ''}`}
      style={color ? cssVars({ '--field-color': color }) : undefined}
    >
      <div className={styles.fieldInfo}>
        <span className={styles.fieldLabel}>{label}</span>
        <span className={`mono tiny caps ${styles.fieldSub}`}>per day</span>
      </div>
      <div className={styles.fieldRight}>
        <button
          onClick={() => onChange(Math.max(0, value - step))}
          className={styles.bumpBtn}
        >
          <MinusIcon size={14} />
        </button>
        <div className={styles.valueBox}>
          <input
            type="number"
            inputMode="numeric"
            value={text}
            onFocus={() => {
              setFocused(true);
              setText('');
            }}
            onBlur={() => {
              setFocused(false);
              if (text === '') setText(String(value));
            }}
            onInput={(e) => {
              const raw = e.currentTarget.value;
              setText(raw);
              onChange(Math.max(0, Number(raw) || 0));
            }}
            className={`mono ${styles.valueInput}`}
            style={cssVars({ '--ch': text.length })}
          />
          {suffix ? (
            <span className={`mono tiny ${styles.valueSuffix}`}>{suffix}</span>
          ) : null}
        </div>
        <button
          onClick={() => onChange(value + step)}
          className={styles.bumpBtn}
        >
          <PlusIcon size={14} />
        </button>
      </div>
    </div>
  );
}

type LegendDotProps = { macroKey: MacroKey; label: string };

function LegendDot({ macroKey, label }: LegendDotProps) {
  return (
    <div className={styles.legendItem}>
      <div className={styles.legendDot} style={cssVars({ '--dot-color': MACRO_META[macroKey].color })} />
      <span className={`mono tiny caps ${styles.legendLabel}`}>{label}</span>
    </div>
  );
}

function SettingsInner({ goals, onSave, onLogout, userEmail }: InnerProps) {
  const close = useSheetClose();
  const [kcal, setKcal] = useState(goals.kcal);
  const [p, setP] = useState(goals.protein);
  const [c, setC] = useState(goals.carbs);
  const [f, setF] = useState(goals.fat);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChangeP = (v: number) => {
    setP(v);
    setKcal(Math.round(v * 4 + c * 4 + f * 9));
  };
  const onChangeC = (v: number) => {
    setC(v);
    setKcal(Math.round(p * 4 + v * 4 + f * 9));
  };
  const onChangeF = (v: number) => {
    setF(v);
    setKcal(Math.round(p * 4 + c * 4 + v * 9));
  };

  const total = p * 4 + c * 4 + f * 9;
  const derivedKcal = Math.round(total);
  const mismatch = Math.abs(derivedKcal - kcal) > 50;
  const pPct = total ? Math.round(((p * 4) / total) * 100) : 0;
  const cPct = total ? Math.round(((c * 4) / total) * 100) : 0;
  const fPct = total ? 100 - pPct - cPct : 0;
  const pctByKey: Record<MacroKey, number> = { protein: pPct, carbs: cPct, fat: fPct };
  const valueByKey: Record<MacroKey, number> = { protein: p, carbs: c, fat: f };
  const setterByKey: Record<MacroKey, (v: number) => void> = {
    protein: onChangeP,
    carbs: onChangeC,
    fat: onChangeF,
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ kcal, protein: p, carbs: c, fat: f });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className={styles.header}>
        <button onClick={close} className={`mono tiny caps ${styles.closeBtn}`}>
          <ArrowLeftIcon size={12} />
          Close
        </button>
        <button
          onClick={save}
          disabled={saving}
          className={`mono tiny caps ${styles.saveBtn}${saving ? ` ${styles.saveBtnSaving}` : ''}`}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div data-sheet-scroll className={`no-scroll ${styles.content}`}>
        <div className={styles.section}>
          <div className={`mono tiny caps ${styles.sectionLabel}`}>Daily goals</div>
          {MACRO_KEYS.map((k) => (
            <GoalField
              key={k}
              label={MACRO_META[k].label}
              value={valueByKey[k]}
              onChange={setterByKey[k]}
              macroKey={k}
            />
          ))}
          <GoalField label="Kcal" value={kcal} onChange={setKcal} suffix="" step={50} isLast />

          <div className={styles.macroCard}>
            <div className={styles.macroHeader}>
              <span className={`mono tiny caps ${styles.macroHeaderTitle}`}>Macro split</span>
              <span className={`mono tiny ${styles.macroHeaderValue}${mismatch ? ` ${styles.macroHeaderValueMismatch}` : ''}`}>
                {derivedKcal} kcal from macros
              </span>
            </div>
            <div className={styles.macroBar}>
              {MACRO_KEYS.map((k) => (
                <div
                  key={k}
                  className={styles.macroSlice}
                  style={cssVars({
                    '--w': `${pctByKey[k]}%`,
                    '--slice-color': MACRO_META[k].color,
                  })}
                />
              ))}
            </div>
            <div className={styles.legend}>
              {MACRO_KEYS.map((k) => (
                <LegendDot
                  key={k}
                  macroKey={k}
                  label={`${MACRO_META[k].short} ${pctByKey[k]}%`}
                />
              ))}
            </div>
            {mismatch ? (
              <div className={styles.mismatchWarn}>
                Heads up — your macros add up to {derivedKcal} kcal, not {kcal}.
              </div>
            ) : null}
          </div>

          {error !== null && (
            <div className={`mono tiny ${styles.errorText}`}>{error}</div>
          )}
        </div>

        <div className={styles.accountSection}>
          <div className={`mono tiny caps ${styles.sectionLabel}`}>Account</div>
          <div className={styles.accountCard}>
            <div className={`mono tiny caps ${styles.accountCardLabel}`}>Signed in as</div>
            <div className={`mono ${styles.accountCardEmail}`}>
              {userEmail ?? 'you@example.com'}
            </div>
          </div>
          <button onClick={onLogout} className={`btn-ghost ${styles.logoutBtn}`}>
            Sign out
          </button>
        </div>

        <div className={styles.footer}>kcal. v1</div>
      </div>
    </>
  );
}
