// NewProductForm — manual product entry, optionally prefilled from an AI scan.
// Banner at the top opens the AI label scanner (parent-routed via onScanLabel).

import { useState } from 'preact/hooks';
import type { Macros } from '../types';
import { Sheet, useSheetClose } from '../components/Sheet';
import { ArrowRightIcon, BarcodeIcon, SparklesIcon, TrashIcon } from '../components/Icon';
import styles from './NewProductForm.module.css';

export type ProductDraft = {
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  barcode: string | null;
  per100: Macros;
  is_temp: boolean;
};

type NewProductFormProps = {
  initial?: Partial<ProductDraft>;
  mode?: 'create' | 'edit';
  onSave: (draft: ProductDraft) => void | Promise<void>;
  // Only meaningful in edit mode. Two-tap inline-confirm UX; tapping the
  // first time arms the button, second tap invokes.
  onDelete?: () => void | Promise<void>;
  onClose: () => void;
  onScanLabel: () => void;
  onScanBarcode: () => void;
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
  return (
    <Sheet onClose={props.onClose}>
      <NewProductFormInner {...props} />
    </Sheet>
  );
}

type InnerProps = Omit<NewProductFormProps, 'onClose'>;

function NewProductFormInner({ initial, mode = 'create', onSave, onDelete, onScanLabel, onScanBarcode }: InnerProps) {
  const close = useSheetClose();
  const initialPer100 = initial?.per100;

  const [name, setName] = useState<string>(initial?.name ?? '');
  const [brand, setBrand] = useState<string>(initial?.brand ?? '');
  const [unit, setUnit] = useState<'g' | 'ml'>(initial?.unit ?? 'g');
  const [kcal, setKcal] = useState<NumField>(toField(initialPer100?.kcal));
  const [protein, setProtein] = useState<NumField>(toField(initialPer100?.protein));
  const [carbs, setCarbs] = useState<NumField>(toField(initialPer100?.carbs));
  const [fat, setFat] = useState<NumField>(toField(initialPer100?.fat));
  const [barcode, setBarcode] = useState<string>(initial?.barcode ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isEdit = mode === 'edit';
  const isTemp = !isEdit && (initial?.is_temp ?? false);
  const prefilled = initial?.per100 !== undefined;

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
        barcode: barcode.trim() ? barcode.trim() : null,
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

  const handleDelete = async () => {
    if (!onDelete || deleting) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={`mono caps ${styles.title}`}>
            {isEdit ? 'Edit Product' : isTemp ? 'Add Temp Item' : 'New Product'}
          </span>
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

      <div className={`no-scroll ${styles.scroll}`}>
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
            <span className={styles.aiArrow}>
              <ArrowRightIcon size={14} />
            </span>
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
          <label className="field-label">Barcode</label>
          <div className={styles.barcodeRow}>
            <input
              className={`field-input ${styles.barcodeInput}`}
              value={barcode}
              onInput={(e) => setBarcode(e.currentTarget.value)}
              placeholder="optional"
              maxLength={64}
              inputMode="numeric"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={onScanBarcode}
              className={styles.barcodeScanBtn}
              aria-label="Scan barcode"
            >
              <BarcodeIcon size={20} />
            </button>
          </div>
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
        {isEdit && onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting || submitting}
            className={`${styles.deleteBtn}${deleteArmed ? ` ${styles.deleteBtnArmed}` : ''}`}
            aria-label={deleteArmed ? 'Confirm delete' : 'Delete product'}
          >
            {deleteArmed ? (
              <span className="mono tiny caps">{deleting ? 'Deleting…' : 'Confirm'}</span>
            ) : (
              <TrashIcon size={16} />
            )}
          </button>
        )}
        <button
          className={`btn-primary ${styles.submitBtn}`}
          disabled={!valid || submitting || deleting}
          onClick={submit}
        >
          {submitting ? (
            'Saving…'
          ) : (
            <>
              {isEdit ? 'Save changes' : isTemp ? 'Add to Day' : 'Save & Continue'}
              <ArrowRightIcon size={16} />
            </>
          )}
        </button>
      </div>
    </>
  );
}
