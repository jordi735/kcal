// Login screen — magic link only

function LoginScreen({ onLogin }) {
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const valid = /\S+@\S+\.\S+/.test(email);

  const submit = () => {
    if (!valid) return;
    setSent(true);
  };

  return (
    <div style={{
      height: '100%',
      minHeight: 844,
      display: 'flex',
      flexDirection: 'column',
      padding: '80px 28px 40px',
      position: 'relative',
    }}>
      {/* Top — brand */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 32,
        }}>
          <span className="mono" style={{
            fontSize: 72,
            fontWeight: 500,
            letterSpacing: '-0.04em',
            color: 'var(--fg)',
            lineHeight: 1,
          }}>KCAL</span>
          <span className="mono tiny caps" style={{
            color: 'var(--accent)',
            marginLeft: 4,
          }}>v1</span>
        </div>
        <div style={{ maxWidth: 300 }}>
          <p style={{
            fontSize: 15,
            lineHeight: 1.5,
            color: 'var(--fg-dim)',
            marginBottom: 8,
          }}>
            A quiet little macro tracker.
          </p>
          <p style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--fg-dimmer)',
            fontFamily: 'var(--mono)',
          }}>
            Four numbers. No noise.
          </p>
        </div>
      </div>

      {/* Bottom — auth */}
      {!sent ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field">
            <label className="field-label">Email</label>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="field-input mono-input"
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
          </div>
          <button className="btn-primary" disabled={!valid} onClick={submit}>
            Send magic link →
          </button>
          <p className="mono tiny" style={{
            textAlign: 'center',
            color: 'var(--fg-dimmer)',
            letterSpacing: '0.06em',
            marginTop: 4,
          }}>
            NO PASSWORDS. JUST A LINK IN YOUR INBOX.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, animation: 'fadeIn 0.4s ease' }}>
          <div style={{
            padding: '20px',
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 16,
          }}>
            <div className="mono tiny caps" style={{ color: 'var(--accent)', marginBottom: 8 }}>
              ✓ LINK SENT
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--fg)' }}>
              Check <span className="mono" style={{ color: 'var(--fg)' }}>{email}</span> — the link expires in 15 minutes.
            </div>
          </div>
          <button
            onClick={onLogin}
            className="btn-ghost"
          >
            I clicked the link (demo)
          </button>
          <button
            onClick={() => { setSent(false); setEmail(''); }}
            style={{
              fontSize: 12,
              color: 'var(--fg-dimmer)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              padding: 12,
            }}
          >
            Use a different email
          </button>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { LoginScreen });
