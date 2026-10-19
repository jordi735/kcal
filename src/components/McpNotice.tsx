import { useState } from 'preact/hooks';
import styles from './McpNotice.module.css';

type Props = {
  version: number | null;
  onDismiss: (version: number) => Promise<void>;
  onOpenGuide: (button: HTMLButtonElement) => void;
};

export function McpNotice({ version, onDismiss, onOpenGuide }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  if (version === null) return null;
  const dismiss = async () => {
    setSaving(true);
    setError(false);
    try { await onDismiss(version); }
    catch { setError(true); }
    finally { setSaving(false); }
  };
  return (
    <aside className={styles.notice} aria-label="ChatGPT connection reminder">
      <p>KCAL’s tools have changed. Refresh your KCAL connection in ChatGPT to load the updated tools.</p>
      <button type="button" onClick={(event) => onOpenGuide(event.currentTarget)} className="mono tiny">Connection guide</button>
      <button type="button" disabled={saving} onClick={dismiss} className="mono tiny">
        {saving ? 'Dismissing…' : 'Dismiss reminder'}
      </button>
      {error && <p role="alert">Couldn’t dismiss the reminder. Please try again.</p>}
    </aside>
  );
}
