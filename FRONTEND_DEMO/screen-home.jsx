// Home screen — week strip + food list + bottom summary

function FoodRow({ entry, products, onClick, onDelete }) {
  const macros = entryMacros(entry, products);
  const name = entryName(entry, products);
  const brand = entryBrand(entry, products);
  const [swipe, setSwipe] = React.useState(false);

  return (
    <div style={{
      position: 'relative',
      borderBottom: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      {swipe && (
        <button
          onClick={() => { onDelete(entry.id); setSwipe(false); }}
          style={{
            position: 'absolute',
            right: 0, top: 0, bottom: 0,
            width: 72,
            background: 'var(--danger)',
            color: '#fff',
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontFamily: 'var(--mono)',
          }}
        >DELETE</button>
      )}
      <button
        onClick={() => onClick && onClick(entry)}
        onContextMenu={e => { e.preventDefault(); setSwipe(s => !s); }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          background: 'var(--bg)',
          textAlign: 'left',
          transform: swipe ? 'translateX(-72px)' : 'translateX(0)',
          transition: 'transform 0.25s ease',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 15,
            color: 'var(--fg)',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {name}
            {entry.tempProduct && (
              <span className="mono tiny caps" style={{
                marginLeft: 8,
                color: 'var(--accent)',
                fontSize: 9,
                padding: '2px 5px',
                border: '1px solid var(--accent)',
                borderRadius: 4,
                verticalAlign: 2,
                letterSpacing: '0.1em',
              }}>TMP</span>
            )}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--fg-dim)', display: 'flex', gap: 10 }}>
            <span>{entry.grams}g</span>
            {brand && <span style={{ color: 'var(--fg-dimmer)' }}>· {brand}</span>}
            <span style={{ color: 'var(--fg-dimmer)' }}>· {entry.time}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <div className="mono" style={{ fontSize: 16, color: 'var(--fg)', fontWeight: 500 }}>
            {Math.round(macros.kcal)}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--fg-dimmer)', display: 'flex', gap: 6 }}>
            <span>P{Math.round(macros.p)}</span>
            <span>C{Math.round(macros.c)}</span>
            <span>F{Math.round(macros.f)}</span>
          </div>
        </div>
      </button>
    </div>
  );
}

function MealGroup({ title, entries, products, totals, onEntryClick, onDelete }) {
  if (!entries.length) return null;
  return (
    <div>
      <div style={{
        padding: '14px 20px 8px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        background: 'var(--bg)',
      }}>
        <span className="mono tiny caps" style={{ color: 'var(--fg-dim)', letterSpacing: '0.14em' }}>
          {title}
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--fg-dimmer)' }}>
          {Math.round(totals.kcal)} kcal
        </span>
      </div>
      {entries.map(e => (
        <FoodRow key={e.id} entry={e} products={products} onClick={onEntryClick} onDelete={onDelete} />
      ))}
    </div>
  );
}

function HomeScreen({
  selectedDate,
  onDateChange,
  entriesByDate,
  products,
  goals,
  onAdd,
  onSettings,
  onDelete,
  onEntryClick,
}) {
  const dateKey = selectedDate.toISOString().slice(0, 10);
  const entries = entriesByDate[dateKey] || [];
  const totals = computeTotals(entries, products);

  const today = new Date();
  const isToday = isSameDay(selectedDate, today);
  const dateLabel = isToday
    ? 'TODAY'
    : selectedDate.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  const subLabel = `${selectedDate.getDate()} ${MONTH_NAMES[selectedDate.getMonth()].slice(0, 3).toUpperCase()} ${selectedDate.getFullYear()}`;

  const getEntriesFor = (d) => entriesByDate[d.toISOString().slice(0, 10)] || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ height: 20 }} />
      {/* Week strip */}
      <WeekStrip
        selectedDate={selectedDate}
        onDateChange={onDateChange}
        goals={goals}
        getEntriesFor={getEntriesFor}
      />

      {/* Food list (scrollable) */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        marginTop: 20,
        borderTop: '1px solid var(--border)',
      }} className="no-scroll">
        {entries.length === 0 ? (
          <div style={{
            padding: '80px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            textAlign: 'center',
          }}>
            <div style={{
              width: 40, height: 40,
              border: '1px dashed var(--border-strong)',
              borderRadius: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="mono" style={{ color: 'var(--fg-dimmer)', fontSize: 20 }}>+</span>
            </div>
            <div className="mono caps" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--fg-dim)' }}>
              No food logged
            </div>
            <div style={{ fontSize: 13, color: 'var(--fg-dimmer)', maxWidth: 220 }}>
              Tap ADD FOOD below to log your first item of the day.
            </div>
          </div>
        ) : (
          <div>
            <div style={{
              padding: '14px 20px 8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}>
              <span className="mono tiny caps" style={{ color: 'var(--fg-dim)', letterSpacing: '0.14em' }}>
                Logged · {entries.length} item{entries.length === 1 ? '' : 's'}
              </span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--fg-dimmer)' }}>
                {Math.round(totals.kcal)} kcal
              </span>
            </div>
            {entries.map(e => (
              <FoodRow key={e.id} entry={e} products={products} onClick={onEntryClick} onDelete={onDelete} />
            ))}
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>

      {/* Bottom summary */}
      <MacroSummary
        totals={totals}
        goals={goals}
        onSettings={onSettings}
        onAdd={onAdd}
      />
    </div>
  );
}

Object.assign(window, { HomeScreen, FoodRow, MealGroup });
