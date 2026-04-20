import { useEffect, useState, useRef } from 'preact/hooks';
import { BrandMark } from '../components/BrandMark';
import type { User } from '../types';
import { api } from '../api';
import styles from './Verify.module.css';

type VerifyProps = {
  onVerified: (user: User, token: string) => void;
  onFailure: () => void;
};

type VerifyResponse = { session_token: string; user: User };

type State =
  | { kind: 'verifying' }
  | { kind: 'missing' }
  | { kind: 'invalid' };

export function Verify({ onVerified, onFailure }: VerifyProps) {
  const [state, setState] = useState<State>({ kind: 'verifying' });

  const onVerifiedRef = useRef(onVerified);
  const onFailureRef = useRef(onFailure);
  useEffect(() => {
    onVerifiedRef.current = onVerified;
    onFailureRef.current = onFailure;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token === null || token === '') {
      setState({ kind: 'missing' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api<VerifyResponse>('/auth/verify', {
          method: 'POST',
          body: { token },
        });
        if (cancelled) return;
        onVerifiedRef.current(res.user, res.session_token);
      } catch {
        if (cancelled) return;
        setState({ kind: 'invalid' });
        setTimeout(() => {
          if (!cancelled) onFailureRef.current();
        }, 1600);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.shell}>
      <BrandMark />

      {state.kind === 'verifying' && (
        <div className={`mono tiny caps ${styles.status}`}>Verifying...</div>
      )}

      {state.kind === 'missing' && (
        <div className={styles.missingBlock}>
          <div className={`mono tiny caps ${styles.missingText}`}>No token in link</div>
          <button className={`btn-ghost ${styles.backBtn}`} onClick={onFailure}>
            Back to sign in
          </button>
        </div>
      )}

      {state.kind === 'invalid' && (
        <div className={`mono tiny caps ${styles.invalidText}`}>
          Invalid or expired link
          <div className={styles.redirecting}>Redirecting...</div>
        </div>
      )}
    </div>
  );
}
