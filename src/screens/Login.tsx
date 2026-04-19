import { useState } from 'preact/hooks';
import { BrandMark } from '../components/BrandMark';
import styles from './Login.module.css';

type LoginProps = {
  onSubmit: (email: string) => void | Promise<void>;
  error?: string;
};

export function Login({ onSubmit, error }: LoginProps) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const valid = /\S+@\S+\.\S+/.test(email);

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(email);
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.shell}>
      <div className={styles.main}>
        <div className={styles.brandWrap}><BrandMark /></div>
        <div className={styles.hints}>
          <p className={styles.tagline}>A quiet little macro tracker.</p>
          <p className={styles.subtagline}>Four numbers. No noise.</p>
        </div>
      </div>

      {!sent ? (
        <div className={styles.form}>
          <div className="field">
            <label className="field-label">Email</label>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onInput={(e) => setEmail(e.currentTarget.value)}
              placeholder="you@example.com"
              className="field-input mono-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
          </div>
          <button
            className="btn-primary"
            disabled={!valid || submitting}
            onClick={submit}
          >
            {submitting ? 'Sending...' : 'Send magic link →'}
          </button>
          {error !== undefined && error !== '' ? (
            <p className={`mono tiny ${styles.errorMsg}`}>{error}</p>
          ) : null}
          <p className={`mono tiny ${styles.helpMsg}`}>
            NO PASSWORDS. JUST A LINK IN YOUR INBOX.
          </p>
        </div>
      ) : (
        <div className={styles.sentBlock}>
          <div className={styles.sentCard}>
            <div className={`mono tiny caps ${styles.sentLabel}`}>✓ LINK SENT</div>
            <div className={styles.sentText}>
              Check <span className={`mono ${styles.sentEmail}`}>{email}</span> — the link
              expires in 15 minutes.
            </div>
          </div>
          <button
            onClick={() => {
              setSent(false);
              setEmail('');
            }}
            className={styles.differentEmail}
          >
            Use a different email
          </button>
        </div>
      )}
    </div>
  );
}
