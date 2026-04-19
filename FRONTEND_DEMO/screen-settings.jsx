// Settings — 4 macro goals + account

function SettingsScreen({ goals, onSave, onClose, onLogout, userEmail }) {
  const [kcal, setKcal] = React.useState(goals.kcal);
  const [p, setP] = React.useState(goals.p);
  const [c, setC] = React.useState(goals.c);
  const [f, setF] = React.useState(goals.f);

  // Derived kcal from macros: 4*p + 4*c + 9*f
  const derivedKcal = Math.round(p * 4 + c * 4 + f * 9);
  const mismatch = Math.abs(derivedKcal - kcal) > 50;

  // Macro %
  const total = p * 4 + c * 4 + f * 9;
  const pPct = total ? Math.round(((p * 4) / total) * 100) : 0;
  const cPct = total ? Math.round(((c * 4) / total) * 100) : 0;
  const fPct = total ? 100 - pPct - cPct : 0;

  const save = () => onSave({ kcal, p, c, f });

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: 'var(--bg)',
      zIndex: 40,
      display: 'flex',
      flexDirection: 'column',
      animation: 'fadeIn 0.2s ease',
    }}>
      {/* Top bar */}
      <div style={{
        padding: '28px 20px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <button onClick={onClose} className="mono tiny caps" style={{ color: 'var(--fg-dim)', letterSpacing: '0.14em' }}>
          ← Close
        </button>
        <span className="mono caps" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--fg-dim)' }}>
          Settings
        </span>
        <button onClick={save} className="mono tiny caps" style={{ color: 'var(--accent)', letterSpacing: '0.14em' }}>
          Save
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 40px' }} className="no-scroll">
        {/* Daily goals section */}
        <div style={{ marginTop: 12, marginBottom: 32 }}>
          <div className="mono tiny caps" style={{ color: 'var(--fg-dim)', letterSpacing: '0.14em', marginBottom: 14 }}>
            Daily goals
          </div>

          <GoalField label="Kcal" value={kcal} onChange={setKcal} suffix="" step={50} />
          <GoalField label="Protein" value={p} onChange={setP} suffix="g" step={5} />
          <GoalField label="Carbs" value={c} onChange={setC} suffix="g" step={5} />
          <GoalField label="Fat" value={f} onChange={setF} suffix="g" isLast />

          {/* Breakdown */}
          <div style={{
            marginTop: 20,
            padding: 16,
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <span className="mono tiny caps" style={{ color: 'var(--fg-dim)', letterSpacing: '0.14em' }}>
                Macro split
              </span>
              <span className="mono tiny" style={{ color: mismatch ? 'var(--danger)' : 'var(--fg-dimmer)' }}>
                {derivedKcal} kcal from macros
              </span>
            </div>
            {/* Stacked bar */}
            <div style={{
              display: 'flex',
              height: 8,
              borderRadius: 4,
              overflow: 'hidden',
              background: 'var(--bg-elev-2)',
            }}>
              <div style={{ width: `${pPct}%`, background: 'var(--accent)', transition: 'width 0.4s ease' }} />
              <div style={{ width: `${cPct}%`, background: 'var(--fg)', transition: 'width 0.4s ease' }} />
              <div style={{ width: `${fPct}%`, background: 'var(--fg-dim)', transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <LegendDot color="var(--accent)" label={`P ${pPct}%`} />
              <LegendDot color="var(--fg)" label={`C ${cPct}%`} />
              <LegendDot color="var(--fg-dim)" label={`F ${fPct}%`} />
            </div>
            {mismatch && (
              <div style={{
                marginTop: 10,
                fontSize: 11,
                color: 'var(--danger)',
                lineHeight: 1.5,
              }}>
                Heads up — your macros add up to {derivedKcal} kcal, not {kcal}.
              </div>
            )}
          </div>

        </div>

        {/* Account section */}
        <div style={{ marginBottom: 30 }}>
          <div className="mono tiny caps" style={{ color: 'var(--fg-dim)', letterSpacing: '0.14em', marginBottom: 14 }}>
            Account
          </div>
          <div style={{
            padding: 16,
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            marginBottom: 10,
          }}>
            <div className="mono tiny caps" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.1em', marginBottom: 4 }}>
              Signed in as
            </div>
            <div className="mono" style={{ color: 'var(--fg)', fontSize: 14 }}>
              {userEmail || 'you@example.com'}
            </div>
          </div>
          <button onClick={onLogout} className="btn-ghost" style={{
            color: 'var(--danger)',
            borderColor: 'rgba(255,90,74,0.3)',
          }}>
            Sign out
          </button>
        </div>

        <div style={{
          textAlign: 'center',
          color: 'var(--fg-dimmest)',
          fontSize: 10,
          letterSpacing: '0.14em',
          fontFamily: 'var(--mono)',
          textTransform: 'uppercase',
        }}>
          KCAL v1
        </div>
      </div>
    </div>
  );
}

function GoalField({ label, value, onChange, suffix = 'g', step = 5, isLast = false }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px 0',
      borderBottom: isLast ? 'none' : '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 15, color: 'var(--fg)' }}>{label}</span>
        <span className="mono tiny caps" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.12em', fontSize: 9 }}>
          per day
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={() => onChange(Math.max(0, value - step))}
          style={{ width: 34, height: 34, borderRadius: 17, border: '1px solid var(--border-strong)', color: 'var(--fg)', fontSize: 16 }}>−</button>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, minWidth: 72, justifyContent: 'center' }}>
          <input
            type="number"
            inputMode="numeric"
            value={value}
            onChange={e => onChange(+e.target.value || 0)}
            className="mono"
            style={{
              fontSize: 20,
              fontWeight: 500,
              color: 'var(--fg)',
              width: `${String(value).length}ch`,
              textAlign: 'center',
              minWidth: '2ch',
            }}
          />
          {suffix && <span className="mono tiny" style={{ color: 'var(--fg-dimmer)' }}>{suffix}</span>}
        </div>
        <button onClick={() => onChange(value + step)}
          style={{ width: 34, height: 34, borderRadius: 17, border: '1px solid var(--border-strong)', color: 'var(--fg)', fontSize: 16 }}>+</button>
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, background: color }} />
      <span className="mono tiny caps" style={{ color: 'var(--fg-dim)', letterSpacing: '0.1em' }}>{label}</span>
    </div>
  );
}

Object.assign(window, { SettingsScreen });
