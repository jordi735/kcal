import { useEffect, useState } from 'preact/hooks';
import { api, requestLoginCode, verifyLoginCode, SESSION_TOKEN_KEY } from '../api';
import type { OAuthConsent, OAuthDecision } from '../types';
import { BrandMark } from '../components/BrandMark';
import { Login } from './Login';
import styles from './OAuthConnect.module.css';

export function OAuthConnect({ request }: { request: string }) {
  const [signedIn, setSignedIn] = useState(() => Boolean(localStorage.getItem(SESSION_TOKEN_KEY)));
  const [consent, setConsent] = useState<OAuthConsent | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void api<OAuthConsent>(`/oauth/consent?request=${request}`).then((data) => {
      if (!cancelled) setConsent(data);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this connection.');
    });
    return () => { cancelled = true; };
  }, [request, signedIn]);

  if (!signedIn) {
    return <Login onRequestCode={requestLoginCode} onVerifyCode={async (email, code) => {
      await verifyLoginCode(email, code);
      setSignedIn(true);
    }} />;
  }

  const decide = async (allow: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<OAuthDecision>('/oauth/consent', {
        method: 'POST', body: { request, allow },
      });
      window.location.assign(result.redirect_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish connecting.');
      setBusy(false);
    }
  };

  return (
    <main className={styles.shell}>
      <BrandMark />
      <h1>Connect to KCAL</h1>
      {consent ? <>
        <p><strong>{consent.client_name}</strong> wants read access to your KCAL account.</p>
        <p className={styles.account}>{consent.email}</p>
        <p>Read your food logs, calorie and macro totals, goals, and weigh-ins.</p>
        <p className={styles.detail}>Your data cannot be changed through this connection.</p>
        <p className={styles.detail}>Return to {consent.redirect_host}</p>
        <div className={styles.actions}>
          <button className="btn-primary" disabled={busy} onClick={() => void decide(true)}>
            {busy ? 'Connecting…' : 'Allow access'}
          </button>
          <button className="btn-secondary" disabled={busy} onClick={() => void decide(false)}>Deny</button>
        </div>
      </> : !error ? <p>Loading connection…</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {error && !consent ? <a href="/">Back to KCAL</a> : null}
    </main>
  );
}
