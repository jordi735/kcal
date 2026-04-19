// NewProductForm — manual product entry, optionally prefilled from an AI scan.
// Banner at the top opens the AI label scanner (parent-routed via onScanLabel).

import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { Macros } from '../types';
import { Sheet, useSheetClose } from '../components/Sheet';
import { SparklesIcon } from '../components/Icon';
import styles from './NewProductForm.module.css';

export type ProductDraft = {
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  barcode: string | null;
  per100: Macros;
  is_temp: boolean;
};

export type NewProductFormProps = {
  initial?: Partial<ProductDraft>;
  mode?: 'create' | 'edit';
  onSave: (draft: ProductDraft) => void | Promise<void>;
  onClose: () => void;
  onScanLabel: () => void;
};

type NumField = number | '';

type NutFieldProps = {
  label: string;
  value: NumField;
  onChange: (v: NumField) => void;
  unit?: string;
};

function NutField({ label, value, onChange, unit }: NutFieldProps) {
  return (
    <div className={styles.nutField}>
      <label className={`mono tiny caps ${styles.nutFieldLabel}`}>{label}</label>
      <div className={styles.nutFieldBox}>
        <input
          type="number"
          inputMode="decimal"
          value={value === '' ? '' : String(value)}
          onInput={(e) => {
            const raw = e.currentTarget.value;
            if (raw === '') {
              onChange('');
              return;
            }
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : '');
          }}
          placeholder="0"
          className={styles.nutFieldInput}
        />
        {unit && <span className={`mono tiny ${styles.nutFieldUnit}`}>{unit}</span>}
      </div>
    </div>
  );
}

function toField(n: number | undefined): NumField {
  return typeof n === 'number' ? n : '';
}

export function NewProductForm(props: NewProductFormProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <Sheet onClose={props.onClose} scrollRef={scrollRef}>
      <NewProductFormInner {...props} scrollRef={scrollRef} />
    </Sheet>
  );
}

type InnerProps = Omit<NewProductFormProps, 'onClose'> & {
  scrollRef: RefObject<HTMLDivElement>;
};

function NewProductFormInner({ initial, mode = 'create', onSave, onScanLabel, scrollRef }: InnerProps) {
  const close = useSheetClose();
  const initialPer100 = initial?.per100;

  const [name, setName] = useState<string>(initial?.name ?? '');
  const [brand, setBrand] = useState<string>(initial?.brand ?? '');
  const [unit, setUnit] = useState<'g' | 'ml'>(initial?.unit ?? 'g');
  const [kcal, setKcal] = useState<NumField>(toField(initialPer100?.kcal));
  const [protein, setProtein] = useState<NumField>(toField(initialPer100?.protein));
  const [carbs, setCarbs] = useState<NumField>(toField(initialPer100?.carbs));
  const [fat, setFat] = useState<NumField>(toField(initialPer100?.fat));
  const [submitting, setSubmitting] = useState(false);

  const isEdit = mode === 'edit';
  const barcode = initial?.barcode ?? null;
  const isTemp = !isEdit && (initial?.is_temp ?? false);
  const prefilled = initial !== undefined && (
    initial.name !== undefined || initial.per100 !== undefined
  );

  const valid =
    name.trim().length > 0 &&
    kcal !== '' &&
    protein !== '' &&
    carbs !== '' &&
    fat !== '';

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        brand: brand.trim() ? brand.trim() : null,
        unit,
        barcode,
        per100: {
          kcal: Number(kcal),
          protein: Number(protein),
          carbs: Number(carbs),
          fat: Number(fat),
        },
        is_temp: isTemp,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={`mono caps ${styles.title}`}>
            {isEdit ? 'Edit Product' : isTemp ? 'Add Temp Item' : 'New Product'}
          </span>
          {barcode && (
            <span className={`mono tiny ${styles.barcode}`}>
              ★ {barcode}{isEdit ? '' : ' · unknown'}
            </span>
          )}
          {isTemp && (
            <span className={`mono tiny ${styles.tempHint}`}>
              One-off. Won't save to library.
            </span>
          )}
        </div>
        <button onClick={close} className={`mono tiny caps ${styles.cancelBtn}`}>
          Cancel
        </button>
      </div>

      <div ref={scrollRef} className={`no-scroll ${styles.scroll}`}>
        {!isEdit && (
          <button
            onClick={onScanLabel}
            className={`${styles.aiBanner}${prefilled ? ` ${styles.aiBannerPrefilled}` : ''}`}
          >
            <div className={styles.aiIcon}>
              <SparklesIcon size={18} />
            </div>
            <div className={styles.aiTextCol}>
              <div className={`mono caps ${styles.aiTitle}`}>
                {prefilled ? '✓ Filled from label' : 'Scan label with AI'}
              </div>
              <div className={`mono tiny ${styles.aiSubtitle}`}>
                {prefilled ? 'Review and adjust below' : 'Auto-fill macros from a photo'}
              </div>
            </div>
            <span className={`mono tiny caps ${styles.aiArrow}`}>→</span>
          </button>
        )}

        <div className="field">
          <label className="field-label">Name *</label>
          <input
            className="field-input"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="e.g. Peanut Butter"
          />
        </div>

        <div className="field">
          <label className="field-label">Brand</label>
          <input
            className="field-input"
            value={brand}
            onInput={(e) => setBrand(e.currentTarget.value)}
            placeholder="optional"
          />
        </div>

        <div className="field">
          <label className="field-label">Measured in</label>
          <div className={styles.unitRow}>
            {(['g', 'ml'] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`${styles.unitBtn}${unit === u ? ` ${styles.unitBtnActive}` : ''}`}
              >
                {u === 'g' ? 'Grams' : 'Millilitres'}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.macroCard}>
          <div className={`mono tiny caps ${styles.macroCardLabel}`}>Per 100{unit}</div>
          <div className={styles.macroGrid}>
            <NutField label="Kcal" value={kcal} onChange={setKcal} />
            <NutField label="Protein" value={protein} onChange={setProtein} unit="g" />
            <NutField label="Carbs" value={carbs} onChange={setCarbs} unit="g" />
            <NutField label="Fat" value={fat} onChange={setFat} unit="g" />
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <button
          className={`btn-primary ${styles.submitBtn}`}
          disabled={!valid || submitting}
          onClick={submit}
        >
          {submitting
            ? 'Saving…'
            : isEdit
              ? 'Save changes →'
              : isTemp
                ? 'Add to Day →'
                : 'Save & Continue →'}
        </button>
      </div>
    </>
  );
}
