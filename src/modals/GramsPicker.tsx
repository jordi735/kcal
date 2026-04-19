// GramsPicker — pick an amount (grams or ml) before adding/editing an entry.

import { useEffect, useState } from 'preact/hooks';
import type { Product } from '../types';
import { computeMacros } from '../mocks';
import { api } from '../api';
import { Sheet } from '../components/Sheet';
import { ArrowRightIcon, MinusIcon, PlusIcon, TrashIcon } from '../components/Icon';
import styles from './GramsPicker.module.css';

export type GramsPickerProps = {
  product: Product;
  initialGrams?: number;
  mode: 'add' | 'edit';
  onConfirm: (grams: number) => void;
  onClose: () => void;
  onDelete?: () => void;
  onEditProduct?: () => void;
};

const DEFAULT_QUICK_VALUES = [50, 100, 150, 200, 250];

export function GramsPicker(props: GramsPickerProps) {
  return (
    <Sheet onClose={props.onClose}>
      <GramsPickerInner {...props} />
    </Sheet>
  );
}

function GramsPickerInner({
  product,
  initialGrams,
  mode,
  onConfirm,
  onDelete,
  onEditProduct,
}: Omit<GramsPickerProps, 'onClose'>) {
  const [history, setHistory] = useState<number[] | null>(null);
  const [grams, setGrams] = useState<number>(initialGrams ?? 100);
  const [userChangedGrams, setUserChangedGrams] = useState(false);
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

  const updateGrams = (next: number) => {
    setUserChangedGrams(true);
    setGrams(next);
  };

  const quickValues =
    history !== null && history.length > 0
      ? history.map((v) => Math.round(v))
      : DEFAULT_QUICK_VALUES;

  const macros = computeMacros(product, grams);
  const round1 = (n: number): number => Math.round(n * 10) / 10;

  const bump = (delta: number) => {
    setUserChangedGrams(true);
    setGrams((g) => Math.max(1, g + delta));
  };

  const title = mode === 'edit' ? 'Edit amount' : 'How much?';
  const confirmLabel = mode === 'edit' ? 'Save' : 'Add to day';

  const preview: Array<{ label: string; val: number; unit: string }> = [
    { label: 'KCAL', val: Math.round(macros.kcal), unit: '' },
    { label: 'P', val: round1(macros.protein), unit: 'g' },
    { label: 'C', val: round1(macros.carbs), unit: 'g' },
    { label: 'F', val: round1(macros.fat), unit: 'g' },
  ];

  return (
    <>
      <div className={styles.header}>
        <span className={`mono caps ${styles.title}`}>{title}</span>
      </div>

      <div className={styles.productRow}>
        <div className={styles.productInfo}>
          <div className={styles.productName}>{product.name}</div>
          {product.brand && (
            <div className={`mono tiny caps ${styles.productBrand}`}>{product.brand}</div>
          )}
        </div>
        {onEditProduct !== undefined && (
          <button
            onClick={onEditProduct}
            className={`mono tiny caps ${styles.editBtn}`}
          >
            Edit Product
          </button>
        )}
      </div>

      <div className={styles.gramsBox}>
        <button onClick={() => bump(-10)} className={styles.bumpBtn}>
          <MinusIcon size={18} />
        </button>
        <div className={styles.gramsRow}>
          <input
            type="number"
            inputMode="numeric"
            value={grams}
            onInput={(e) => {
              const n = Number(e.currentTarget.value);
              updateGrams(Math.max(1, Number.isFinite(n) ? n : 0));
            }}
            className={`mono ${styles.gramsInput}`}
            style={{ ['--ch' as any]: Math.max(2, String(grams).length) }}
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
            onClick={() => updateGrams(v)}
            className={`${styles.quickBtn}${grams === v ? ` ${styles.quickBtnActive}` : ''}`}
          >
            {v}
          </button>
        ))}
      </div>

      <div className={styles.macros}>
        {preview.map((x) => (
          <div key={x.label} className={styles.macroCol}>
            <span className={`mono tiny caps ${styles.macroLabel}`}>{x.label}</span>
            <div className={styles.macroRow}>
              <span className={`mono ${styles.macroValue}`}>{x.val}</span>
              {x.unit && <span className={`mono tiny ${styles.macroUnit}`}>{x.unit}</span>}
            </div>
          </div>
        ))}
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
