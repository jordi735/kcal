import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { isGoalAmount, MAX_GOAL_KCAL, MAX_GOAL_MACRO_GRAMS } from '../../shared/constraints';
import type { Goals, GoalHistoryItem } from '../types';
import { MACRO_KEYS, MACRO_META, type MacroKey } from '../macros';
import { cssVars } from '../styles';
import { Sheet, useSheetClose } from '../components/Sheet';
import { ChatGPTConnectCard, ChatGPTGuide, useChatGPTGuide } from '../components/ChatGPTGuide';
import { McpNotice } from '../components/McpNotice';
import { MinusIcon, PlusIcon } from '../components/Icon';
import { useFocusClearableNumber } from '../hooks/useFocusClearableNumber';
import styles from './Settings.module.css';

type SettingsProps = {
  initialGuide?: boolean;
  goals: Goals;
  ready: boolean;
  loadError: boolean;
  onRetry: () => void;
  goalHistory: GoalHistoryItem[] | undefined;
  noticeVersion: number | null;
  onDismissNotice: (version: number) => Promise<void>;
  onSave: (goals: Goals) => Promise<void>;
  onClose: () => void;
  onLogout: () => void;
  userEmail: string | null;
};

export function Settings(props: SettingsProps) {
  const { guideOpen, openGuide, closeGuide } = useChatGPTGuide(props.initialGuide);
  const { guideOpen: historyOpen, openGuide: openHistory, closeGuide: closeHistory } = useChatGPTGuide();
  return (
    <Sheet onClose={props.onClose} style={cssVars({ '--sheet-height': '92%' })}>
      <div className={styles.pane} hidden={guideOpen || historyOpen}>
        <SettingsInner {...props} active={!guideOpen && !historyOpen} onOpenGuide={openGuide} onOpenHistory={openHistory} />
      </div>
      {guideOpen && <ChatGPTGuide onBack={closeGuide} />}
      {historyOpen && <GoalHistory history={props.goalHistory} onBack={closeHistory} />}
    </Sheet>
  );
}

type InnerProps = Omit<SettingsProps, 'onClose'> & {
  active: boolean;
  onOpenGuide: (button: HTMLButtonElement) => void;
  onOpenHistory: (button: HTMLButtonElement) => void;
};

type GoalFieldProps = {
  label: string;
  value: number;
  onChange: (n: number) => void;
  macroKey?: MacroKey;
  suffix?: string;
  step?: number;
  isLast?: boolean;
  disabled: boolean;
  max?: number;
};

function GoalField({ label, value, onChange, macroKey, suffix = 'g', step = 5, isLast = false,
  disabled, max = MAX_GOAL_MACRO_GRAMS }: GoalFieldProps) {
  const { text, setText, onFocus, onBlur } = useFocusClearableNumber(value);
  const color = macroKey !== undefined ? MACRO_META[macroKey].color : undefined;

  // iOS Safari keeps focus on the input when a sibling button is tapped, so
  // the hook's useEffect won't fire. Force-sync text alongside onChange.
  const bump = (next: number) => {
    if (disabled) return;
    const bounded = Math.max(0, Math.min(max, next));
    onChange(bounded);
    setText(String(bounded));
  };

  return (
    <div
      className={`${styles.field}${isLast ? ` ${styles.fieldLast}` : ''}`}
      style={color ? cssVars({ '--field-color': color }) : undefined}
    >
      <div className={styles.fieldInfo}>
        <span className={styles.fieldLabel}>{label}</span>
        <span className={`mono tiny caps ${styles.fieldSub}`}>per day</span>
          {!isGoalAmount(value, max) && <span className={`mono tiny ${styles.errorText}`}>
            Use a whole number from 0 to {max}.
          </span>}
      </div>
      <div className={styles.fieldRight}>
        <button
          onClick={() => bump(Math.max(0, value - step))}
          disabled={disabled}
          className={styles.bumpBtn}
        >
          <MinusIcon size={14} />
        </button>
        <div className={styles.valueBox}>
          <input
            type="number"
            inputMode="numeric"
            aria-label={label}
            min={0}
            max={max}
            step={1}
            disabled={disabled}
            value={text}
            onFocus={onFocus}
            onBlur={onBlur}
            onInput={(e) => {
              const raw = e.currentTarget.value;
              setText(raw);
              onChange(Number(raw));
            }}
            className={`mono ${styles.valueInput}`}
            style={cssVars({ '--ch': text.length })}
          />
          {suffix ? (
            <span className={`mono tiny ${styles.valueSuffix}`}>{suffix}</span>
          ) : null}
        </div>
        <button
          onClick={() => bump(value + step)}
          disabled={disabled}
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

function SettingsInner({ goals, ready, loadError, onRetry, noticeVersion, onDismissNotice, onSave, onLogout, userEmail, active, onOpenGuide, onOpenHistory }: InnerProps) {
  const close = useSheetClose();
  const [kcal, setKcal] = useState(goals.kcal);
  const [p, setP] = useState(goals.protein);
  const [c, setC] = useState(goals.carbs);
  const [f, setF] = useState(goals.fat);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);

  // A pristine form follows the authoritative snapshot. Once the user changes
  // any field, the complete draft belongs to them until this Sheet is closed.
  useLayoutEffect(() => {
    if (dirty.current) return;
    setKcal(goals.kcal);
    setP(goals.protein);
    setC(goals.carbs);
    setF(goals.fat);
  }, [goals.kcal, goals.protein, goals.carbs, goals.fat]);
  const edit = (setter: (value: number) => void) => (value: number) => {
    dirty.current = true;
    setter(value);
  };
  const valid = isGoalAmount(kcal, MAX_GOAL_KCAL)
    && [p, c, f].every((value) => isGoalAmount(value, MAX_GOAL_MACRO_GRAMS));

  // No cross-field auto-derive: bumping a macro never overwrites kcal. The
  // mismatch banner below surfaces drift between the typed kcal and the
  // macro-derived total, leaving the user as the single source of truth.
  const total = p * 4 + c * 4 + f * 9;
  const derivedKcal = Math.round(total);
  const mismatch = Math.abs(derivedKcal - kcal) > 50;
  const pPct = total ? Math.round(((p * 4) / total) * 100) : 0;
  const cPct = total ? Math.round(((c * 4) / total) * 100) : 0;
  const fPct = total ? 100 - pPct - cPct : 0;
  const pctByKey: Record<MacroKey, number> = { protein: pPct, carbs: cPct, fat: fPct };
  const valueByKey: Record<MacroKey, number> = { protein: p, carbs: c, fat: f };
  const setterByKey: Record<MacroKey, (v: number) => void> = {
    protein: edit(setP),
    carbs: edit(setC),
    fat: edit(setF),
  };

  const save = async () => {
    if (!ready || !valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ kcal, protein: p, carbs: c, fat: f });
      close();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Save failed';
      setError(message === 'goal_date_before_latest'
        ? 'Your local date is earlier than your latest saved goal. Try again when your local date has caught up.'
        : message === 'app_refresh_required' ? 'Refresh KCAL before saving your goals.' : message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className={styles.header}>
        <button onClick={close} className={`mono tiny caps ${styles.closeBtn}`}>
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!ready || !valid || saving}
          className={`mono tiny caps ${styles.saveBtn}${saving ? ` ${styles.saveBtnSaving}` : ''}`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div data-sheet-scroll={active ? '' : undefined} className={`no-scroll ${styles.content}`}>
        <div className={styles.section}>
          <div className={`mono tiny caps ${styles.sectionLabel}`}>Daily goals</div>
          <p className="mono tiny">Changes apply from today. Earlier days keep their recorded goals.</p>
          {!ready && (loadError ? <div className="mono tiny">
            <p>Couldn’t load goals. Try again.</p>
            <button type="button" onClick={onRetry}>Retry</button>
          </div> : <p className="mono tiny">Loading goals…</p>)}
          {MACRO_KEYS.map((k) => (
            <GoalField
              key={k}
              label={MACRO_META[k].label}
              value={valueByKey[k]}
              onChange={setterByKey[k]}
              macroKey={k}
              disabled={!ready || saving}
            />
          ))}
          <GoalField label="Kcal" value={kcal} onChange={edit(setKcal)} suffix="" step={50}
            max={MAX_GOAL_KCAL} disabled={!ready || saving} isLast />

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

        <div className={styles.section}>
          <button type="button" className="mono tiny caps" onClick={(event) => onOpenHistory(event.currentTarget)}>Goal history</button>
        </div>

        <McpNotice version={noticeVersion} onDismiss={onDismissNotice} onOpenGuide={onOpenGuide} />
        <div className={styles.connectionSection}>
          <ChatGPTConnectCard onOpen={onOpenGuide} />
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

function GoalHistory({ history, onBack }: { history: GoalHistoryItem[] | undefined; onBack: () => void }) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <>
    <div className={styles.header}>
      <button type="button" onClick={onBack} className={`mono tiny caps ${styles.closeBtn}`}>Back</button>
    </div>
    <div data-sheet-scroll className={`no-scroll ${styles.content}`}>
      <h2 ref={heading} tabIndex={-1}>Goal history</h2>
      <p className="mono tiny">Goals carry forward until the next change. Dates before the first record have no recorded goal.</p>
      {history === undefined ? <p className="mono tiny">Loading goals…</p> : [...history].reverse().map((item) => (
        <div key={item.effective_date} className={styles.historyRow}>
          <time className="mono tiny" dateTime={item.effective_date}>{item.effective_date}</time>
          <span className="mono tiny">{item.goals.kcal} kcal · P {item.goals.protein}g · C {item.goals.carbs}g · F {item.goals.fat}g</span>
        </div>
      ))}
    </div>
  </>;
}
