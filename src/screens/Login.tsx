import { useEffect, useRef, useState } from 'preact/hooks';
import { BrandMark } from '../components/BrandMark';
import { ClearableField } from '../components/ClearableField';
import { ArrowRightIcon } from '../components/Icon';
import { ApiError } from '../api';
import styles from './Login.module.css';

type LoginProps = {
  onRequestCode: (email: string) => Promise<void>;
  onVerifyCode: (email: string, code: string) => Promise<void>;
};

type Step = 'email' | 'code';

const RESEND_COOLDOWN_S = 30;

export function Login({ onRequestCode, onVerifyCode }: LoginProps) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [info, setInfo] = useState<string | undefined>(undefined);
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const emailValid = /\S+@\S+\.\S+/.test(email);

  useEffect(() => {
    if (step !== 'code') return;
    const t = window.setTimeout(() => codeInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [step]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendCooldown]);

  const submitEmail = async () => {
    if (!emailValid || submitting) return;
    setSubmitting(true);
    setError(undefined);
    setInfo(undefined);
    try {
      await onRequestCode(email);
      setStep('code');
      setCode('');
      setResendCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not send code';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (resendCooldown > 0 || submitting) return;
    setSubmitting(true);
    setError(undefined);
    setInfo(undefined);
    try {
      await onRequestCode(email);
      setCode('');
      setInfo('A new code was sent.');
      setResendCooldown(RESEND_COOLDOWN_S);
      codeInputRef.current?.focus();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not resend code';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitCode = async (digits: string) => {
    if (digits.length !== 6 || verifying) return;
    setVerifying(true);
    setError(undefined);
    setInfo(undefined);
    try {
      await onVerifyCode(email, digits);
    } catch (err) {
      if (err instanceof ApiError && err.message === 'too_many_attempts') {
        setStep('email');
        setCode('');
        setError('Too many attempts — request a new code.');
      } else {
        const message = err instanceof ApiError ? err.message : 'Verification failed';
        setError(
          message === 'invalid_or_expired_code' ? 'Invalid or expired code.' : message,
        );
        setCode('');
        codeInputRef.current?.focus();
      }
    } finally {
      setVerifying(false);
    }
  };

  const useDifferentEmail = () => {
    setStep('email');
    setCode('');
    setError(undefined);
    setInfo(undefined);
    setResendCooldown(0);
  };

  const onCodeInput = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void submitCode(digits);
  };

  return (
    <main className={styles.shell}>
      <h1 className="visually-hidden">kcal. — a quiet little macro tracker</h1>
      <div className={styles.main}>
        <div className={styles.brandWrap}><BrandMark /></div>
        <div className={styles.hints}>
          <p className={styles.tagline}>A quiet little macro tracker.</p>
          <p className={styles.subtagline}>Four numbers. No noise.</p>
        </div>
      </div>

      {step === 'email' ? (
        <div className={styles.form}>
          <div className="field">
            <label className="field-label">Email</label>
            <ClearableField
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              className="mono-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitEmail();
              }}
            />
          </div>
          <button
            className={`btn-primary ${styles.submitBtn}`}
            disabled={!emailValid || submitting}
            onClick={submitEmail}
          >
            {submitting ? (
              'Sending...'
            ) : (
              <>
                Send sign-in code
                <ArrowRightIcon size={16} />
              </>
            )}
          </button>
          {error !== undefined && error !== '' ? (
            <p className={`mono tiny ${styles.errorMsg}`}>{error}</p>
          ) : null}
          <p className={`mono tiny ${styles.helpMsg}`}>
            NO PASSWORDS. JUST A 6-DIGIT CODE.
          </p>
        </div>
      ) : (
        <div className={styles.form}>
          <div className={styles.sentCard}>
            <div className={`mono tiny caps ${styles.sentLabel}`}>✓ CODE SENT</div>
            <div className={styles.sentText}>
              Check <span className={`mono ${styles.sentEmail}`}>{email}</span> and enter
              the 6-digit code below.
            </div>
          </div>
          <div className="field">
            <label className="field-label">Code</label>
            <input
              ref={codeInputRef}
              type="tel"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onInput={(e) => onCodeInput(e.currentTarget.value)}
              className={`field-input mono-input ${styles.codeInput}`}
              placeholder="••••••"
              aria-label="6-digit sign-in code"
              disabled={verifying}
            />
          </div>
          {verifying ? (
            <p className={`mono tiny ${styles.helpMsg}`}>Verifying...</p>
          ) : null}
          {error !== undefined && error !== '' ? (
            <p className={`mono tiny ${styles.errorMsg}`}>{error}</p>
          ) : null}
          {info !== undefined && info !== '' && error === undefined && !verifying ? (
            <p className={`mono tiny ${styles.helpMsg}`}>{info}</p>
          ) : null}
          <div className={styles.codeActions}>
            <button
              type="button"
              onClick={resend}
              disabled={resendCooldown > 0 || submitting || verifying}
              className={styles.differentEmail}
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </button>
            <button
              type="button"
              onClick={useDifferentEmail}
              className={styles.differentEmail}
              disabled={verifying}
            >
              Use a different email
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
