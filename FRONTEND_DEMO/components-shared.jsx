// Shared UI primitives

// Thin labelled macro bar — used in the bottom summary
function MacroBar({ label, consumed, goal, unit = 'g', accent = false }) {
  const pct = Math.min(100, (consumed / goal) * 100);
  const over = consumed > goal;
  const left = Math.max(0, goal - consumed);
  const displayPct = over ? 100 : pct;

  // Same thirds-based color ramp as the kcal bar
  const ratio = goal > 0 ? consumed / goal : 0;
  let barColor;
  if (over || ratio >= 1)     barColor = '#fb4934'; // red
  else if (ratio >= 2 / 3)    barColor = '#fe8019'; // orange
  else if (ratio >= 1 / 3)    barColor = '#fabd2f'; // yellow
  else                        barColor = '#b8bb26'; // green

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="mono tiny caps" style={{ color: 'var(--fg-dim)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 11, color: over ? 'var(--danger)' : 'var(--fg)' }}>
          {over ? `+${Math.round(consumed - goal)}` : Math.round(left)}<span style={{ color: 'var(--fg-dimmer)' }}>{unit}</span>
        </span>
      </div>
      <div style={{
        height: 3,
        background: 'var(--bg-elev-2)',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          top: 0, left: 0, bottom: 0,
          width: `${displayPct}%`,
          background: barColor,
          borderRadius: 2,
          transition: 'width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.3s ease',
          transformOrigin: 'left',
        }} />
      </div>
    </div>
  );
}

// Week strip: week number, prev/next, 7 day pills with dots for progress
function WeekStrip({ selectedDate, onDateChange, goals, getEntriesFor }) {
  const [weekOffset, setWeekOffset] = React.useState(() => {
    const today = new Date();
    const thisMonday = getMonday(today);
    const selMonday = getMonday(selectedDate);
    return Math.round((selMonday - thisMonday) / (7 * 86400000));
  });

  const today = new Date();
  const thisMonday = getMonday(today);
  const displayMonday = new Date(thisMonday);
  displayMonday.setDate(thisMonday.getDate() + weekOffset * 7);
  const days = weekDays(displayMonday);
  const weekNum = getWeekNumber(days[0]);
  const year = days[0].getFullYear();

  // Are we on the currently-selected week?
  React.useEffect(() => {
    const selMonday = getMonday(selectedDate);
    const newOffset = Math.round((selMonday - thisMonday) / (7 * 86400000));
    if (newOffset !== weekOffset) setWeekOffset(newOffset);
  }, [selectedDate]);

  const monthLabel = (() => {
    const first = days[0];
    const last = days[6];
    if (first.getMonth() === last.getMonth()) {
      return `${MONTH_NAMES[first.getMonth()].slice(0, 3).toUpperCase()} ${year}`;
    }
    return `${MONTH_NAMES[first.getMonth()].slice(0, 3).toUpperCase()}–${MONTH_NAMES[last.getMonth()].slice(0, 3).toUpperCase()} ${year}`;
  })();

  return (
    <div style={{ padding: '0 20px', paddingTop: 8 }}>
      {/* Week header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <button
          onClick={() => setWeekOffset(w => w - 1)}
          style={{ padding: '4px 8px', color: 'var(--fg-dim)', fontSize: 18, marginLeft: -8 }}
        >‹</button>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span className="mono tiny caps" style={{ color: 'var(--fg-dimmer)' }}>
            {monthLabel}
          </span>
          <span className="mono caps" style={{ fontSize: 13, letterSpacing: '0.12em', color: 'var(--fg)' }}>
            Week {String(weekNum).padStart(2, '0')}
          </span>
        </div>
        <button
          onClick={() => setWeekOffset(w => w + 1)}
          style={{ padding: '4px 8px', color: 'var(--fg-dim)', fontSize: 18, marginRight: -8 }}
        >›</button>
      </div>

      {/* Days */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 6,
      }}>
        {days.map((d, i) => {
          const isSelected = isSameDay(d, selectedDate);
          const isToday = isSameDay(d, today);
          const isFuture = d > today;
          const entries = getEntriesFor ? getEntriesFor(d) : [];
          const totals = entries.length ? computeTotals(entries, window.__allProducts || SEED_PRODUCTS) : null;
          const progress = totals ? Math.min(1, totals.kcal / goals.kcal) : 0;

          return (
            <button
              key={i}
              onClick={() => !isFuture && onDateChange(d)}
              disabled={isFuture}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: '10px 0 8px',
                borderRadius: 12,
                background: isSelected ? 'var(--accent)' : 'transparent',
                border: isSelected ? 'none' : isToday ? '1px solid var(--border-strong)' : '1px solid transparent',
                color: isSelected ? 'var(--accent-ink)' : isFuture ? 'var(--fg-dimmest)' : 'var(--fg)',
                opacity: isFuture ? 0.4 : 1,
                transition: 'all 0.2s ease',
              }}
            >
              <span className="mono tiny" style={{
                color: isSelected ? 'var(--accent-ink)' : 'var(--fg-dimmer)',
                fontSize: 9,
                letterSpacing: '0.1em',
              }}>{DAY_LETTERS[i]}</span>
              <span className="mono" style={{ fontSize: 15, fontWeight: 500 }}>
                {d.getDate()}
              </span>
              {/* Progress dot */}
              <div style={{
                width: 4, height: 4, borderRadius: 2,
                background: isSelected
                  ? progress > 0 ? 'var(--accent-ink)' : 'transparent'
                  : progress > 0.9 ? 'var(--accent)'
                    : progress > 0 ? 'var(--fg-dim)'
                    : 'transparent',
                opacity: progress > 0 ? Math.max(0.4, progress) : 0,
                transition: 'all 0.2s ease',
              }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Bottom macros summary — 4 thin bars + kcal headline
function MacroSummary({ totals, goals, onSettings, onAdd }) {
  const kcalLeft = Math.max(0, goals.kcal - totals.kcal);
  const kcalOver = totals.kcal > goals.kcal;
  const kcalPct = Math.min(100, (totals.kcal / goals.kcal) * 100);

  return (
    <div style={{
      background: 'var(--bg-elev)',
      borderTop: '1px solid var(--border)',
      padding: '18px 20px 16px',
    }}>
      {/* headline kcal row */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="mono tiny caps" style={{ color: 'var(--fg-dim)' }}>
            {kcalOver ? 'Over budget' : 'Kcal remaining'}
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="mono" style={{
              fontSize: 32,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              color: kcalOver ? 'var(--danger)' : 'var(--fg)',
            }}>
              {kcalOver ? '+' : ''}{Math.round(kcalOver ? totals.kcal - goals.kcal : kcalLeft)}
            </span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--fg-dimmer)' }}>
              / {goals.kcal}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span className="mono tiny caps" style={{ color: 'var(--fg-dim)' }}>Consumed</span>
          <span className="mono" style={{ fontSize: 14, color: 'var(--fg)' }}>
            {Math.round(totals.kcal)} <span style={{ color: 'var(--fg-dimmer)' }}>kcal</span>
          </span>
        </div>
      </div>

      {/* Big kcal bar */}
      <div style={{
        height: 6,
        background: 'var(--bg-elev-2)',
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: 16,
      }}>
        <div style={{
          height: '100%',
          width: `${kcalPct}%`,
          background: kcalOver ? 'var(--danger)' : 'var(--accent)',
          borderRadius: 3,
          transition: 'width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }} />
      </div>

      {/* 3 macro bars */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18, marginBottom: 20 }}>
        <MacroBar label="Protein" consumed={totals.p} goal={goals.p} />
        <MacroBar label="Carbs" consumed={totals.c} goal={goals.c} />
        <MacroBar label="Fat" consumed={totals.f} goal={goals.f} />
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={onSettings}
          style={{
            flex: '0 0 auto',
            width: 54,
            height: 54,
            borderRadius: 14,
            border: '1px solid var(--border-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--fg)',
            transition: 'background 0.2s ease',
          }}
          onPointerDown={e => e.currentTarget.style.background = 'var(--bg-elev-2)'}
          onPointerUp={e => e.currentTarget.style.background = 'transparent'}
          onPointerLeave={e => e.currentTarget.style.background = 'transparent'}
          aria-label="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
        </button>
        <button
          onClick={onAdd}
          className="btn-primary"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            height: 54,
            padding: 0,
            borderRadius: 14,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          ADD FOOD
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { MacroBar, WeekStrip, MacroSummary });
