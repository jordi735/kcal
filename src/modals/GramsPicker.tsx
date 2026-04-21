// GramsPicker — pick an amount (grams or ml) before adding/editing an entry.

import { useEffect, useState } from 'preact/hooks';
import type { Goals, Macros, Product } from '../types';
import { MACRO_KEYS, MACRO_META } from '../macros';
import { cssVars } from '../styles';
import { computeMacros } from '../mocks';
import { api } from '../api';
import { Sheet } from '../components/Sheet';
import { useFocusClearableNumber } from '../hooks/useFocusClearableNumber';
import { ArrowRightIcon, MinusIcon, PencilIcon, PlusIcon, TrashIcon } from '../components/Icon';
import styles from './GramsPicker.module.css';

type GramsPickerProps = {
  product: Product;
  initialGrams?: number;
  mode: 'add' | 'edit';
  goals: Goals;
  existingTotals: Macros;
  onConfirm: (grams: number) => void;
  onClose: () => void;
  onDelete?: () => void;
  onEditProduct?: () => void;
};

const DEFAULT_QUICK_VALUES = [50, 100, 150, 200, 250];

const fmtInt = (n: number): string => String(Math.round(n));
const fmtOneDecimal = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

export function GramsPicker(props: GramsPickerProps) {
  return (
    <Sheet onClose={props.onClose}>
      <GramsPickerInner {...props} />
    </Sheet>
  );
}

type GoalRowProps = {
  label: string;
  existing: number;
  entry: number;
  goal: number;
  unit: string;
  fmt: (n: number) => string;
  color: string;
  colorDim: string;
};

function GoalRow({ label, existing, entry, goal, unit, fmt, color, colorDim }: GoalRowProps) {
  const total = existing + entry;
  const over = total >= goal && goal > 0;

  const toTrackPct = (val: number): number =>
    goal > 0 ? Math.min((val / goal) * 100, 100) : 0;

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
      <div className={styles.track}>
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
      </div>
      <span className={`mono ${styles.numbers}`}>
        <span className={`${styles.current}${over ? ` ${styles.currentOver}` : ''}`}>
          {fmt(total)}
        </span>
        <span className={styles.goal}>
          / {fmtInt(goal)}{unit}
        </span>
      </span>
    </div>
  );
}

function GramsPickerInner({
  product,
  initialGrams,
  mode,
  goals,
  existingTotals,
  onConfirm,
  onDelete,
  onEditProduct,
}: Omit<GramsPickerProps, 'onClose'>) {
  const [history, setHistory] = useState<number[] | null>(null);
  const [grams, setGrams] = useState<number>(initialGrams ?? 100);
  const [userChangedGrams, setUserChangedGrams] = useState(false);
  const { text, setText, onFocus, onBlur } = useFocusClearableNumber(grams);
  const unit = product.unit;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ grams: number[] }>(
          `/entries/recent-grams?product_id=${product.id}`,
        );
        if (!cancelled) setHistory(data.grams);
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
    if (userChangedGrams) return;
    if (initialGrams !== undefined) return;
    if (history === null || history.length === 0) return;
    setGrams(history[0]!);
  }, [history, mode, initialGrams, userChangedGrams]);

  const quickValues =
    history !== null && history.length > 0
      ? history.map((v) => Math.round(v))
      : DEFAULT_QUICK_VALUES;

  const macros = computeMacros(product, grams);

  // Button-triggered grams change (bump +/- and quick-value row). Syncs
  // `text` alongside `grams` because iOS Safari keeps focus on the input
  // when a sibling button is tapped — the hook's useEffect won't fire.
  // The input's own onInput keeps its inline setText(raw) instead so the
  // user's raw typing isn't clobbered by the clamped value.
  const selectGrams = (next: number) => {
    setUserChangedGrams(true);
    setGrams(next);
    setText(String(next));
  };

  const bump = (delta: number) => selectGrams(Math.max(1, grams + delta));

  const title = mode === 'edit' ? 'Edit amount' : 'How much?';
  const confirmLabel = mode === 'edit' ? 'Save' : 'Add to day';

  return (
    <>
      <div className={styles.header}>
        <span className={`mono caps ${styles.title}`}>{title}</span>
        {onEditProduct !== undefined && (
          <button
            onClick={onEditProduct}
            className={styles.editBtn}
            aria-label="Edit product"
          >
            <PencilIcon size={16} />
          </button>
        )}
      </div>

      <div data-sheet-scroll className={`no-scroll ${styles.scroll}`}>
        <div className={styles.productRow}>
          <div className={styles.productInfo}>
            <div className={styles.productName}>{product.name}</div>
            {product.brand && (
              <div className={`mono tiny caps ${styles.productBrand}`}>{product.brand}</div>
            )}
          </div>
        </div>

        <div className={styles.macros}>
          <GoalRow
            label="Kcal"
            existing={existingTotals.kcal}
            entry={macros.kcal}
            goal={goals.kcal}
            unit=""
            fmt={fmtInt}
            color="var(--fg)"
            colorDim="var(--fg-dimmer)"
          />
          {MACRO_KEYS.map((k) => (
            <GoalRow
              key={k}
              label={MACRO_META[k].label}
              color={MACRO_META[k].color}
              colorDim={MACRO_META[k].colorDim}
              existing={existingTotals[k]}
              entry={macros[k]}
              goal={goals[k]}
              unit="g"
              fmt={fmtOneDecimal}
            />
          ))}
        </div>

        <div className={styles.gramsBox}>
          <button onClick={() => bump(-10)} className={styles.bumpBtn}>
            <MinusIcon size={18} />
          </button>
          <div className={styles.gramsRow}>
            <input
              type="number"
              inputMode="numeric"
              value={text}
              onFocus={onFocus}
              onBlur={onBlur}
              onInput={(e) => {
                const raw = e.currentTarget.value;
                setText(raw);
                const n = Number(raw);
                setUserChangedGrams(true);
                setGrams(Math.max(1, Number.isFinite(n) ? n : 0));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                  onConfirm(grams);
                }
              }}
              className={`mono ${styles.gramsInput}`}
              style={cssVars({ '--ch': Math.max(2, text.length) })}
            />
            <span className={`mono ${styles.gramsUnit}`}>{unit}</span>
          </div>
          <button onClick={() => bump(10)} className={styles.bumpBtn}>
            <PlusIcon size={18} />
          </button>
        </div>

        <div className={styles.quickRow}>
          {quickValues.map((v) => (
            <button
              key={v}
              onClick={() => selectGrams(v)}
              className={`${styles.quickBtn}${grams === v ? ` ${styles.quickBtnActive}` : ''}`}
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
        <button className={`btn-primary ${styles.confirmBtn}`} onClick={() => onConfirm(grams)}>
          {confirmLabel}
          <ArrowRightIcon size={16} />
        </button>
      </div>
    </>
  );
}
