// AmountPicker — pick g/ml, or correct a logged food and its clock time.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Goals, Macros, Product } from '../types';
import { computeMacros, MACRO_KEYS, MACRO_META } from '../macros';
import { cssVars } from '../styles';
import { api } from '../api';
import { Sheet } from '../components/Sheet';
import { useSheetSubview } from '../hooks/useSheetSubview';
import { isEntryAmount, isLocalTime, MAX_ENTRY_AMOUNT, MIN_ENTRY_AMOUNT } from '../../shared/constraints';
import { AddPickerContent } from './AddPicker';
import { ArrowRightIcon, MinusIcon, PencilIcon, PlusIcon, TrashIcon } from '../components/Icon';
import styles from './AmountPicker.module.css';

export type EntryEditorDraft = {
  amountText: string;
  amountChanged: boolean;
  localTime: string;
  timeChanged: boolean;
};
export type AmountSelection = { product_id: number; unit: Product['unit']; amount: number; local_time?: string };

type AmountPickerProps = {
  product: Product;
  initialAmount?: number;
  initialUnit?: Product['unit'];
  initialTime?: string;
  initialDraft?: EntryEditorDraft;
  mode: 'add' | 'edit';
  goals: Goals | null | undefined;
  existingTotals: Macros;
  onConfirm: (selection: AmountSelection) => void;
  onClose: () => void;
  onDelete?: () => void;
  onEditProduct?: (product: Product, draft: EntryEditorDraft) => void;
  refreshVersion: number;
  onRefreshError: () => void;
};

const DEFAULT_QUICK_VALUES = [50, 100, 150, 200, 250];

const fmtInt = (n: number): string => String(Math.round(n));
const fmtOneDecimal = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

export function AmountPicker(props: AmountPickerProps) {
  return (
    <Sheet onClose={props.onClose}>
      <AmountPickerInner {...props} />
    </Sheet>
  );
}

type GoalRowProps = {
  label: string;
  existing: number;
  entry: number;
  goal: number | null | undefined;
  unit: string;
  fmt: (n: number) => string;
  color: string;
  colorDim: string;
};

function GoalRow({ label, existing, entry, goal, unit, fmt, color, colorDim }: GoalRowProps) {
  const total = existing + entry;
  const over = goal != null && total > goal;

  const toTrackPct = (val: number): number =>
    goal != null && goal > 0 ? Math.min((val / goal) * 100, 100) : 0;

  const existingWidth = toTrackPct(existing);
  const totalWidth = toTrackPct(total);
  const entryWidth = Math.max(0, totalWidth - existingWidth);

  return (
    <div className={styles.row}>
      <span
        className={`mono tiny caps ${styles.rowLabel}`}
        style={{ color }}
      >
        {label}
      </span>
      {goal != null ? <div className={styles.track}>
        <div
          className={styles.fillExisting}
          style={{
            width: `${existingWidth}%`,
            background: over ? 'var(--danger)' : colorDim,
          }}
        />
        <div
          className={styles.fillEntry}
          style={{
            left: `${existingWidth}%`,
            width: `${entryWidth}%`,
            background: over ? 'var(--danger)' : color,
          }}
        />
      </div> : <div />}
      <span className={`mono ${styles.numbers}`}>
        <span className={`${styles.current}${over ? ` ${styles.currentOver}` : ''}`}>
          {fmt(total)}
        </span>
        {goal != null && <span className={styles.goal}>
          / {fmtInt(goal)}{unit}
        </span>}
      </span>
    </div>
  );
}

function AmountPickerInner({
  product: originalProduct,
  initialAmount,
  initialUnit,
  initialTime,
  initialDraft,
  mode,
  goals,
  existingTotals,
  onConfirm,
  onDelete,
  onEditProduct,
  refreshVersion,
  onRefreshError,
}: Omit<AmountPickerProps, 'onClose'>) {
  const foodPicker = useSheetSubview();
  const [replacement, setReplacement] = useState<Product | null>(null);
  const product = replacement ?? originalProduct;
  const [history, setHistory] = useState<number[] | null>(null);
  const [amount, setAmount] = useState<number | null>(() => initialDraft !== undefined
    ? initialDraft.amountText.trim() === '' ? null : Number(initialDraft.amountText)
    : initialAmount ?? 100);
  const [userChangedAmount, setUserChangedAmount] = useState(initialDraft?.amountChanged ?? false);
  const [text, setText] = useState(initialDraft?.amountText ?? String(initialAmount ?? 100));
  const focused = useRef(false);
  const [localTime, setLocalTime] = useState(initialDraft?.localTime ?? initialTime ?? '');
  const [userChangedTime, setUserChangedTime] = useState(initialDraft?.timeChanged ?? false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const unit = product.unit;

  useEffect(() => {
    if (!focused.current) setText(amount === null ? '' : String(amount));
  }, [amount]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ amounts: number[] }>(
          `/entries/recent-amounts?product_id=${product.id}`,
        );
        if (!cancelled) setHistory(data.amounts);
      } catch {
        if (!cancelled) setHistory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  useEffect(() => {
    if (mode !== 'add') return;
    if (userChangedAmount) return;
    if (initialAmount !== undefined) return;
    if (initialDraft !== undefined) return;
    if (history === null || history.length === 0) return;
    setAmount(history[0]!);
  }, [history, mode, initialAmount, initialDraft, userChangedAmount]);

  const quickValues =
    history !== null && history.length > 0
      ? history.map((v) => Math.round(v))
      : DEFAULT_QUICK_VALUES;

  const macros = computeMacros(product, amount ?? 0);

  // Button-triggered amount change (bump +/- and quick-value row). Syncs
  // `text` alongside `amount` because iOS Safari keeps focus on the input
  // when a sibling button is tapped — unfocused synchronization won't run.
  // The input's own onInput keeps its inline setText(raw) instead so the
  // user's raw typing isn't clobbered by the clamped value.
  const selectAmount = (next: number) => {
    setUserChangedAmount(true);
    setAmount(next);
    setText(String(next));
  };

  const bump = (delta: number) => selectAmount(
    Math.min(MAX_ENTRY_AMOUNT, Math.max(MIN_ENTRY_AMOUNT, (amount ?? 0) + delta)),
  );
  // Unchanged legacy fields remain usable for partial corrections. Their old
  // values are omitted from PATCH; new input still follows current validation.
  const preserveAmount = mode === 'edit' && !userChangedAmount && amount === initialAmount && unit === initialUnit;
  const amountError = !preserveAmount && !isEntryAmount(amount);
  const timeError = mode === 'edit' && userChangedTime && !isLocalTime(localTime);

  const editorDraft = (): EntryEditorDraft => {
    const raw = inputRef.current?.value ?? text;
    return {
      amountText: raw.trim() === '' && !userChangedAmount && amount !== null ? String(amount) : raw,
      amountChanged: userChangedAmount,
      localTime: userChangedTime ? timeRef.current?.value ?? localTime : localTime,
      timeChanged: userChangedTime,
    };
  };

  const pickReplacement = (next: Product) => {
    if (next.unit !== product.unit) {
      setUserChangedAmount(true);
      setAmount(null);
      setText('');
    }
    setReplacement(next);
    setHistory(null);
    foodPicker.close();
  };

  // Read from the input at the submit boundary. A blur/click can arrive before
  // Preact has rendered the latest onInput state, while the DOM already holds
  // the user's value (notably on touch devices and Playwright's fill + tap).
  const confirmCurrentValue = (raw = inputRef.current?.value ?? text) => {
    if (raw.trim() === '') return;
    const n = Number(raw);
    const unchangedAmount = preserveAmount && n === initialAmount;
    const amount = unchangedAmount
      ? n : Math.max(MIN_ENTRY_AMOUNT, Number.isFinite(n) ? n : 0);
    if (!unchangedAmount && !isEntryAmount(amount)) {
      setAmount(amount);
      setText(raw);
      return;
    }
    const time = timeRef.current?.value ?? localTime;
    if (mode === 'edit' && userChangedTime && !isLocalTime(time)) {
      setLocalTime(time);
      return;
    }
    onConfirm({ product_id: product.id, unit, amount,
      ...(mode === 'edit' && userChangedTime ? { local_time: time } : {}),
    });
  };

  const title = mode === 'edit' ? 'Edit entry' : 'How much?';
  const confirmLabel = mode === 'edit' ? 'Save' : 'Add to day';

  return (
    <>
      <div className={styles.pane} hidden={foodPicker.isOpen}>
        <div className={styles.header}>
          <span className={`mono caps ${styles.title}`}>{title}</span>
          {onEditProduct !== undefined && (
            <button
              onClick={() => onEditProduct(product, editorDraft())}
              className={styles.editBtn}
              aria-label="Edit product"
            >
              <PencilIcon size={16} />
            </button>
          )}
        </div>

        <div {...(!foodPicker.isOpen ? { 'data-sheet-scroll': true } : {})} className={`no-scroll ${styles.scroll}`}>
          <div className={styles.productRow}>
            <div className={styles.productInfo}>
              <div className={styles.productName}>{product.name}</div>
              {product.brand && (
                <div className={`mono tiny caps ${styles.productBrand}`}>{product.brand}</div>
              )}
            </div>
            {mode === 'edit' && <button
              className={`mono tiny caps ${styles.changeFood}`}
              onClick={(event) => foodPicker.open(event.currentTarget)}
            >Change food</button>}
          </div>

          {mode === 'edit' && <label className={styles.timeField}>
            <span className="mono tiny caps">Time</span>
            <input ref={timeRef} type="time" aria-label="Entry time" value={localTime}
              aria-invalid={timeError} onInput={(event) => {
                setUserChangedTime(true);
                setLocalTime(event.currentTarget.value);
              }} />
            {timeError && <span role="alert" className={styles.amountError}>Enter a time in HH:MM format.</span>}
          </label>}

          <div className={styles.macros} role="group" aria-label="Daily totals">
            {goals == null && <p className="mono tiny">{goals === undefined ? 'Loading goals…' : 'No goal recorded for this day'}</p>}
            <GoalRow
              label="Kcal"
              existing={existingTotals.kcal}
              entry={macros.kcal}
              goal={goals?.kcal}
              unit=""
              fmt={fmtInt}
              color="var(--kcal)"
              colorDim="var(--kcal-dim)"
            />
            {MACRO_KEYS.map((k) => (
              <GoalRow
                key={k}
                label={MACRO_META[k].label}
                color={MACRO_META[k].color}
                colorDim={MACRO_META[k].colorDim}
                existing={existingTotals[k]}
                entry={macros[k]}
                goal={goals?.[k]}
                unit="g"
                fmt={fmtOneDecimal}
              />
            ))}
          </div>

          <div className={styles.amountBox}>
            <div className={styles.amountControls}>
              <button onClick={() => bump(-10)} className={styles.bumpBtn}>
                <MinusIcon size={18} />
              </button>
              <div className={styles.amountRow}>
                <input
                  ref={inputRef}
                  type="number"
                  inputMode="numeric"
                  aria-invalid={amountError}
                  aria-describedby={amountError ? 'amount-error' : undefined}
                  value={text}
                  onFocus={() => { focused.current = true; setText(''); }}
                  onBlur={() => {
                    focused.current = false;
                    if (text === '') setText(amount === null ? '' : String(amount));
                  }}
                  onInput={(e) => {
                    const raw = e.currentTarget.value;
                    setText(raw);
                    // Empty input is a transient state — keep the prior `amount`
                    // so a subsequent Enter doesn't silently submit Math.max(1, 0).
                    if (raw.trim() === '') return;
                    const n = Number(raw);
                    setUserChangedAmount(true);
                    setAmount(Math.max(MIN_ENTRY_AMOUNT, Number.isFinite(n) ? n : 0));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const raw = e.currentTarget.value;
                      if (raw.trim() === '') return;
                      e.currentTarget.blur();
                      confirmCurrentValue(raw);
                    }
                  }}
                  className={`mono ${styles.amountInput}`}
                  style={cssVars({ '--ch': Math.max(2, text.length) })}
                />
                <span className={`mono ${styles.amountUnit}`}>{unit}</span>
              </div>
              <button onClick={() => bump(10)} className={styles.bumpBtn}>
                <PlusIcon size={18} />
              </button>
            </div>

            {amountError && <p id="amount-error" role="alert" className={styles.amountError}>
              Amount must be between {MIN_ENTRY_AMOUNT} and {MAX_ENTRY_AMOUNT} {unit}.
            </p>}

            <section className={styles.portion} aria-label="This portion">
              <dl className={styles.portionMacros}>
                <div className={styles.portionMacro} style={{ color: 'var(--kcal)' }}>
                  <dt className={`mono ${styles.portionLabel}`}>Kcal</dt>
                  <dd className={`mono ${styles.portionValue}`}>{fmtInt(macros.kcal)}</dd>
                </div>
                {MACRO_KEYS.map((k) => (
                  <div key={k} className={styles.portionMacro} style={{ color: MACRO_META[k].color }}>
                    <dt className={`mono ${styles.portionLabel}`}>{MACRO_META[k].label}</dt>
                    <dd className={`mono ${styles.portionValue}`}>{fmtOneDecimal(macros[k])} g</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          <div className={styles.quickRow}>
            {quickValues.map((v) => (
              <button
                key={v}
                onClick={() => selectAmount(v)}
                className={`${styles.quickBtn}${amount === v ? ` ${styles.quickBtnActive}` : ''}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          {onDelete && (
            <button
              onClick={onDelete}
              className={styles.deleteBtn}
              aria-label="Delete entry"
            >
              <TrashIcon size={16} />
            </button>
          )}
          <button className={`btn-primary ${styles.confirmBtn}`} onClick={() => confirmCurrentValue()}>
            {confirmLabel}
            <ArrowRightIcon size={16} />
          </button>
        </div>
      </div>
      {foodPicker.isOpen && <AddPickerContent
        savedOnly
        onBack={foodPicker.close}
        onPick={pickReplacement}
        onCreateNew={() => {}}
        onAddTemp={() => {}}
        onScanBarcode={() => {}}
        addedProductIds={new Set()}
        refreshVersion={refreshVersion}
        onRefreshError={onRefreshError}
      />}
    </>
  );
}
