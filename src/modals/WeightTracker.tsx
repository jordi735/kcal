// Weight history and its small add/edit flow, kept inside one dismissible Sheet.

import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { Sheet, useSheetClose } from '../components/Sheet';
import { ArrowRightIcon, PlusIcon, TrashIcon, WeightIcon } from '../components/Icon';
import { toLocalDateString } from '../dates';
import { cssVars } from '../styles';
import type { WeightEntry, WeightInput } from '../types';
import styles from './WeightTracker.module.css';

type WeightTrackerProps = {
  onClose: () => void;
};

type View =
  | { kind: 'history' }
  | { kind: 'create' }
  | { kind: 'edit'; entry: WeightEntry };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE_LENGTH = 500;

function sortEntries(entries: WeightEntry[]): WeightEntry[] {
  return [...entries].sort((a, b) => b.local_date.localeCompare(a.local_date));
}

function formatDate(localDate: string): string {
  const [year, month, day] = localDate.split('-');
  const months = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];
  const monthName = months[Number(month) - 1];
  if (year === undefined || day === undefined || monthName === undefined) return localDate;
  return `${day} ${monthName} ${year}`;
}

export function WeightTracker({ onClose }: WeightTrackerProps) {
  return (
    <Sheet onClose={onClose} style={cssVars({ '--sheet-height': '92%' })}>
      <WeightTrackerInner />
    </Sheet>
  );
}

function WeightTrackerInner() {
  const close = useSheetClose();
  const [entries, setEntries] = useState<WeightEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [view, setView] = useState<View>({ kind: 'history' });

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setLoadError(false);
    void api<WeightEntry[]>('/weights')
      .then((list) => {
        if (!cancelled) setEntries(sortEntries(list));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadVersion]);

  const openAdd = () => {
    if (entries === null) return;
    const today = toLocalDateString(new Date());
    const existing = entries.find((entry) => entry.local_date === today);
    setView(existing === undefined ? { kind: 'create' } : { kind: 'edit', entry: existing });
  };

  const save = async (input: WeightInput, existingId: number | null): Promise<void> => {
    const collision = entries?.find(
      (entry) => entry.local_date === input.local_date && entry.id !== existingId,
    );
    if (collision !== undefined) throw new ApiError('weight_exists', 409);

    const saved = await api<WeightEntry>(
      existingId === null ? '/weights' : `/weights/${existingId}`,
      {
        method: existingId === null ? 'POST' : 'PUT',
        body: input,
      },
    );
    setEntries((current) =>
      sortEntries([...(current ?? []).filter((entry) => entry.id !== saved.id), saved]),
    );
    setView({ kind: 'history' });
  };

  const remove = async (entry: WeightEntry): Promise<void> => {
    await api<{ ok: true }>(`/weights/${entry.id}`, { method: 'DELETE' });
    setEntries((current) => (current ?? []).filter((item) => item.id !== entry.id));
    setView({ kind: 'history' });
  };

  if (view.kind !== 'history') {
    return (
      <WeightForm
        mode={view.kind}
        {...(view.kind === 'edit' ? { entry: view.entry } : {})}
        onCancel={() => setView({ kind: 'history' })}
        onSave={save}
        onDelete={remove}
      />
    );
  }

  return (
    <>
      <div className={styles.header}>
        <span className={`mono caps ${styles.title}`}>Weight history</span>
        <button type="button" onClick={close} className={`mono tiny caps ${styles.closeBtn}`}>
          Close
        </button>
      </div>

      <div data-sheet-scroll className={`no-scroll ${styles.history}`}>
        {entries === null && !loadError && (
          <div className={`mono tiny caps ${styles.status}`}>Loading...</div>
        )}

        {loadError && (
          <div className={styles.emptyState}>
            <div className={`mono caps ${styles.emptyTitle}`}>Couldn't load weights</div>
            <div className={styles.emptyHint}>Check your connection and try again.</div>
            <button
              type="button"
              className={`btn-secondary ${styles.retryBtn}`}
              onClick={() => setReloadVersion((version) => version + 1)}
            >
              Retry
            </button>
          </div>
        )}

        {entries !== null && entries.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}><WeightIcon size={22} /></div>
            <div className={`mono caps ${styles.emptyTitle}`}>No weigh-ins yet</div>
            <div className={styles.emptyHint}>Add your first weight to start a simple history.</div>
          </div>
        )}

        {entries !== null && entries.length > 0 && (
          <div className={styles.rows}>
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`weight-row ${styles.weightRow}`}
                aria-label={`Edit weigh-in for ${entry.local_date}`}
                onClick={() => setView({ kind: 'edit', entry })}
              >
                <div className={styles.rowTop}>
                  <span className={`mono ${styles.weightValue}`}>
                    {entry.weight_kg.toFixed(1)} <span className={styles.weightUnit}>kg</span>
                  </span>
                  <span className={`mono tiny caps ${styles.date}`}>
                    {formatDate(entry.local_date)}
                  </span>
                </div>
                <div className={styles.conditions}>
                  Peed: {entry.peed ? 'Yes' : 'No'} · Pooped: {entry.pooped ? 'Yes' : 'No'}
                </div>
                {entry.note !== null && <div className={styles.note}>{entry.note}</div>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={`btn-primary ${styles.addBtn}`}
          onClick={openAdd}
          disabled={entries === null}
        >
          <PlusIcon size={16} />
          Add weight
        </button>
      </div>
    </>
  );
}

type WeightFormProps = {
  mode: 'create' | 'edit';
  entry?: WeightEntry | undefined;
  onCancel: () => void;
  onSave: (input: WeightInput, existingId: number | null) => Promise<void>;
  onDelete: (entry: WeightEntry) => Promise<void>;
};

function WeightForm({ mode, entry, onCancel, onSave, onDelete }: WeightFormProps) {
  const [localDate, setLocalDate] = useState(
    entry?.local_date ?? toLocalDateString(new Date()),
  );
  const [weight, setWeight] = useState(entry === undefined ? '' : entry.weight_kg.toFixed(1));
  const [peed, setPeed] = useState(entry?.peed ?? true);
  const [pooped, setPooped] = useState(entry?.pooped ?? false);
  const [note, setNote] = useState(entry?.note ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numericWeight = Number(weight);
  const validWeight =
    weight.trim() !== '' &&
    Number.isFinite(numericWeight) &&
    numericWeight >= 0.1 &&
    numericWeight <= 1000 &&
    Math.abs(numericWeight * 10 - Math.round(numericWeight * 10)) < 1e-9;
  const valid = DATE_RE.test(localDate) && validWeight && note.length <= MAX_NOTE_LENGTH;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSave(
        {
          local_date: localDate,
          weight_kg: numericWeight,
          peed,
          pooped,
          note: note.trim() === '' ? null : note.trim(),
        },
        entry?.id ?? null,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? 'A weigh-in already exists for this date.'
          : "Couldn't save this weigh-in. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    if (entry === undefined || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onDelete(entry);
    } catch {
      setError("Couldn't delete this weigh-in. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className={styles.header}>
        <span className={`mono caps ${styles.title}`}>
          {mode === 'edit' ? 'Edit weight' : 'Add weight'}
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className={`mono tiny caps ${styles.closeBtn}`}
        >
          Cancel
        </button>
      </div>

      <form
        className={styles.formShell}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div data-sheet-scroll className={`no-scroll ${styles.formScroll}`}>
          <label className="field">
            <span className="field-label">Date</span>
            <input
              type="date"
              value={localDate}
              onInput={(event) => setLocalDate(event.currentTarget.value)}
              className={`field-input mono-input ${styles.dateInput}`}
              aria-label="Date"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Weight</span>
            <div className={styles.weightInputWrap}>
              <input
                type="number"
                inputMode="decimal"
                min="0.1"
                max="1000"
                step="0.1"
                value={weight}
                onInput={(event) => setWeight(event.currentTarget.value)}
                className={`mono ${styles.weightInput}`}
                aria-label="Weight"
                placeholder="0.0"
                autoFocus
                required
              />
              <span className={`mono ${styles.inputUnit}`}>kg</span>
            </div>
            {weight.trim() !== '' && !validWeight && (
              <span className={styles.fieldError}>Use 0.1–1000.0 kg with one decimal at most.</span>
            )}
          </label>

          <fieldset className={styles.conditionsField} disabled={submitting}>
            <legend className="field-label">Before weigh-in</legend>
            <div className={styles.checkboxOptions}>
              <label className={styles.checkboxOption}>
                <input
                  type="checkbox"
                  checked={peed}
                  onChange={(event) => setPeed(event.currentTarget.checked)}
                  className={styles.checkbox}
                />
                <span>Peed</span>
              </label>
              <label className={styles.checkboxOption}>
                <input
                  type="checkbox"
                  checked={pooped}
                  onChange={(event) => setPooped(event.currentTarget.checked)}
                  className={styles.checkbox}
                />
                <span>Pooped</span>
              </label>
            </div>
          </fieldset>

          <label className="field">
            <span className="field-label">Note</span>
            <textarea
              value={note}
              onInput={(event) => setNote(event.currentTarget.value)}
              className={styles.noteInput}
              aria-label="Note"
              placeholder="optional"
              maxLength={MAX_NOTE_LENGTH}
              rows={5}
            />
            <span className={`mono tiny ${styles.noteCount}`}>
              {note.length}/{MAX_NOTE_LENGTH}
            </span>
          </label>

          {error !== null && <div className={styles.formError}>{error}</div>}
        </div>

        <div className={styles.formActions}>
          {entry !== undefined && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={submitting}
              className={styles.deleteBtn}
              aria-label="Delete weigh-in"
            >
              <TrashIcon size={16} />
            </button>
          )}
          <button
            type="submit"
            disabled={!valid || submitting}
            className={`btn-primary ${styles.saveBtn}`}
          >
            {submitting ? 'Saving...' : mode === 'edit' ? 'Save' : 'Add weigh-in'}
            {!submitting && <ArrowRightIcon size={16} />}
          </button>
        </div>
      </form>
    </>
  );
}
