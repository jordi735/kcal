// Small Sheet for creating, renaming, or dissolving a day entry group.

import { useState } from 'preact/hooks';
import { ClearableField } from '../components/ClearableField';
import { Sheet, useSheetClose } from '../components/Sheet';
import styles from './EntryGroupForm.module.css';

type EntryGroupFormProps = {
  mode: 'create' | 'edit';
  initialName?: string | undefined;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
  onUngroup?: (() => Promise<void>) | undefined;
};

const MAX_NAME_LENGTH = 64;

export function EntryGroupForm(props: EntryGroupFormProps) {
  return (
    <Sheet onClose={props.onClose}>
      <EntryGroupFormInner {...props} />
    </Sheet>
  );
}

function EntryGroupFormInner({
  mode,
  initialName,
  onSave,
  onUngroup,
}: Omit<EntryGroupFormProps, 'onClose'>) {
  const close = useSheetClose();
  const [name, setName] = useState(initialName ?? '');
  const [submitting, setSubmitting] = useState(false);
  const normalized = name.trim();
  const valid = normalized.length > 0 && normalized.length <= MAX_NAME_LENGTH;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSave(normalized);
    } catch {
      // App owns error reporting; keep this Sheet and its local name for retry.
    } finally {
      setSubmitting(false);
    }
  };

  const dissolve = async () => {
    if (onUngroup === undefined || submitting) return;
    setSubmitting(true);
    try {
      await onUngroup();
    } catch {
      // App owns error reporting; leave the edit Sheet open for retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className={styles.header}>
        <span className={`mono caps ${styles.title}`}>
          {mode === 'create' ? 'Name group' : 'Edit group'}
        </span>
        <button type="button" onClick={close} className={styles.cancelBtn}>
          Cancel
        </button>
      </div>

      <div className={styles.body}>
        <label className="field">
          <span className="field-label">Group name</span>
          <ClearableField
            value={name}
            onChange={setName}
            placeholder="e.g. Ice cream"
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            autoFocus
            aria-label="Group name"
          />
        </label>
      </div>

      <div className={styles.actions}>
        {mode === 'edit' && onUngroup !== undefined && (
          <button
            type="button"
            onClick={() => void dissolve()}
            disabled={submitting}
            className={styles.ungroupBtn}
          >
            Ungroup
          </button>
        )}
        <button type="submit" disabled={!valid || submitting} className="btn-primary">
          {submitting ? 'Saving...' : mode === 'create' ? 'Group items' : 'Save'}
        </button>
      </div>
    </form>
  );
}
