import { useEffect, useState } from 'preact/hooks';
import { useFadeClose } from '../hooks/useFadeClose';
import type { Goals } from '../types';
import { ArrowLeftIcon, MinusIcon, PlusIcon } from '../components/Icon';
import styles from './Settings.module.css';

type SettingsProps = {
  goals: Goals;
  onSave: (goals: Goals) => Promise<void>;
  onClose: () => void;
  onLogout: () => void;
  userEmail: string | null;
};

type GoalFieldProps = {
  label: string;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  step?: number;
  isLast?: boolean;
};

function GoalField({ label, value, onChange, suffix = 'g', step = 5, isLast = false }: GoalFieldProps) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  return (
    <div className={`${styles.field}${isLast ? ` ${styles.fieldLast}` : ''}`}>
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
            style={{ ['--ch' as any]: text.length }}
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

type LegendDotProps = { color: string; label: string };

function LegendDot({ color, label }: LegendDotProps) {
  return (
    <div className={styles.legendItem}>
      <div className={styles.legendDot} style={{ ['--dot-color' as any]: color }} />
      <span className={`mono tiny caps ${styles.legendLabel}`}>{label}</span>
    </div>
  );
}

export function Settings({ goals, onSave, onClose, onLogout, userEmail }: SettingsProps) {
  const [kcal, setKcal] = useState(goals.kcal);
  const [p, setP] = useState(goals.protein);
  const [c, setC] = useState(goals.carbs);
  const [f, setF] = useState(goals.fat);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { closing, requestClose } = useFadeClose(onClose);
  const [mounted, setMounted] = useState(false);

  // Slide in: mount at translateY(100%), then flip to translateY(0) next
  // frame so the CSS transition has two distinct values to interpolate
  // between. Setting it during the same render would apply translateY(0)
  // on first paint and skip the animation.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

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

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ kcal, protein: p, carbs: c, fat: f });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`${styles.shell}${mounted && !closing ? ` ${styles.shellVisible}` : ''}${closing ? ' fullscreen-exit' : ''}`}
    >
      <div className={styles.header}>
        <button onClick={requestClose} className={`mono tiny caps ${styles.closeBtn}`}>
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

      <div className={`no-scroll ${styles.content}`}>
        <div className={styles.section}>
          <div className={`mono tiny caps ${styles.sectionLabel}`}>Daily goals</div>
          <GoalField label="Protein" value={p} onChange={onChangeP} suffix="g" step={5} />
          <GoalField label="Carbs" value={c} onChange={onChangeC} suffix="g" step={5} />
          <GoalField label="Fat" value={f} onChange={onChangeF} suffix="g" />
          <GoalField label="Kcal" value={kcal} onChange={setKcal} suffix="" step={50} isLast />

          <div className={styles.macroCard}>
            <div className={styles.macroHeader}>
              <span className={`mono tiny caps ${styles.macroHeaderTitle}`}>Macro split</span>
              <span className={`mono tiny ${styles.macroHeaderValue}${mismatch ? ` ${styles.macroHeaderValueMismatch}` : ''}`}>
                {derivedKcal} kcal from macros
              </span>
            </div>
            <div className={styles.macroBar}>
              <div
                className={`${styles.macroSlice} ${styles.macroSliceP}`}
                style={{ ['--w' as any]: `${pPct}%` }}
              />
              <div
                className={`${styles.macroSlice} ${styles.macroSliceC}`}
                style={{ ['--w' as any]: `${cPct}%` }}
              />
              <div
                className={`${styles.macroSlice} ${styles.macroSliceF}`}
                style={{ ['--w' as any]: `${fPct}%` }}
              />
            </div>
            <div className={styles.legend}>
              <LegendDot color="var(--macro-p)" label={`P ${pPct}%`} />
              <LegendDot color="var(--macro-c)" label={`C ${cPct}%`} />
              <LegendDot color="var(--macro-f)" label={`F ${fPct}%`} />
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
    </div>
  );
}
