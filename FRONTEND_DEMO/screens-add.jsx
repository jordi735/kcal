// ADD flow — recents/search, barcode scan, new product, grams picker

// ───────── Picker: search + recents + actions ─────────
function AddPicker({ products, recents, onClose, onPickProduct, onScan, onAddNew, onAddTemp }) {
  const [q, setQ] = React.useState('');
  const inputRef = React.useRef(null);
  React.useEffect(() => { setTimeout(() => inputRef.current && inputRef.current.focus(), 350); }, []);

  const filtered = q.trim()
    ? products.filter(p =>
        p.name.toLowerCase().includes(q.toLowerCase()) ||
        (p.brand && p.brand.toLowerCase().includes(q.toLowerCase()))
      )
    : products.filter(p => recents.includes(p.id)).slice(0, 8);

  const emptySearch = q.trim() && filtered.length === 0;

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="sheet" style={{ height: '80%' }}>
        <div className="sheet-handle" />

        {/* Header */}
        <div style={{
          padding: '18px 20px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}>
          <span className="mono caps" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--fg-dim)' }}>
            Add Food
          </span>
          <button onClick={onClose} className="mono tiny caps" style={{ color: 'var(--fg-dim)' }}>
            Cancel
          </button>
        </div>

        {/* Search + scan */}
        <div style={{ padding: '0 20px 14px', display: 'flex', gap: 10 }}>
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--bg-elev-2)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '0 14px',
            height: 48,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--fg-dimmer)' }}>
              <circle cx="11" cy="11" r="7"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={inputRef}
              placeholder="Search products..."
              value={q}
              onChange={e => setQ(e.target.value)}
              style={{ fontSize: 15, flex: 1 }}
            />
            {q && (
              <button onClick={() => setQ('')} style={{ color: 'var(--fg-dimmer)', fontSize: 16, padding: 4 }}>×</button>
            )}
          </div>
          <button
            onClick={onScan}
            style={{
              width: 48,
              height: 48,
              flexShrink: 0,
              border: '1px solid var(--border-strong)',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--fg)',
            }}
            aria-label="Scan barcode"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 7V5a2 2 0 012-2h2M4 17v2a2 2 0 002 2h2M16 3h2a2 2 0 012 2v2M16 21h2a2 2 0 002-2v-2"/>
              <line x1="7" y1="8" x2="7" y2="16"/>
              <line x1="10" y1="8" x2="10" y2="16"/>
              <line x1="13" y1="8" x2="13" y2="16"/>
              <line x1="17" y1="8" x2="17" y2="16"/>
            </svg>
          </button>
        </div>

        {/* List header */}
        <div style={{ padding: '8px 20px 6px', display: 'flex', justifyContent: 'space-between' }}>
          <span className="mono tiny caps" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.14em' }}>
            {q.trim() ? (emptySearch ? 'No matches' : `${filtered.length} result${filtered.length === 1 ? '' : 's'}`) : 'Recent'}
          </span>
          <span className="mono tiny caps" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.14em' }}>
            per 100g
          </span>
        </div>

        {/* Results list */}
        <div style={{ flex: 1, overflow: 'auto' }} className="no-scroll">
          {emptySearch ? (
            <div style={{
              padding: '40px 24px',
              textAlign: 'center',
              color: 'var(--fg-dim)',
              fontSize: 13,
              lineHeight: 1.6,
            }}>
              <div className="mono" style={{ color: 'var(--fg)', marginBottom: 6 }}>"{q}"</div>
              not in your library yet.
            </div>
          ) : (
            filtered.map(p => (
              <button
                key={p.id}
                onClick={() => onPickProduct(p)}
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--border)',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </div>
                  {p.brand && (
                    <div className="mono tiny" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.06em' }}>
                      {p.brand.toUpperCase()}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                  <span className="mono" style={{ fontSize: 14, color: 'var(--fg)' }}>{p.per100.kcal}</span>
                  <span className="mono tiny" style={{ color: 'var(--fg-dimmer)' }}>
                    P{Math.round(p.per100.p)} C{Math.round(p.per100.c)} F{Math.round(p.per100.f)}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Bottom actions */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: 10,
          background: 'var(--bg-elev)',
        }}>
          <button onClick={() => onAddTemp(q)} className="btn-secondary" style={{ flex: 1 }}>
            + Add Temp
          </button>
          <button onClick={() => onAddNew(q)} className="btn-primary" style={{ flex: 1, padding: '14px 20px' }}>
            + Add New
          </button>
        </div>
      </div>
    </>
  );
}

// ───────── Barcode scanner ─────────
function BarcodeScanner({ onClose, onScan }) {
  // Fake scan — after 1.6s, call onScan with a fake barcode
  React.useEffect(() => {
    const t = setTimeout(() => onScan('5411188110897'), 2200);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <div className="overlay" style={{ background: 'rgba(0,0,0,0.92)' }} onClick={onClose} />
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 52,
        display: 'flex',
        flexDirection: 'column',
        animation: 'fadeIn 0.3s ease',
      }}>
        {/* Top bar */}
        <div style={{
          padding: '40px 20px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span className="mono caps" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--fg)' }}>
            SCAN BARCODE
          </span>
          <button onClick={onClose} style={{
            fontSize: 22,
            color: 'var(--fg)',
            width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        {/* Viewfinder */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}>
          <div style={{
            width: 260,
            height: 160,
            position: 'relative',
          }}>
            {/* corners */}
            {[
              { top: 0, left: 0, borderTop: '2px solid var(--accent)', borderLeft: '2px solid var(--accent)' },
              { top: 0, right: 0, borderTop: '2px solid var(--accent)', borderRight: '2px solid var(--accent)' },
              { bottom: 0, left: 0, borderBottom: '2px solid var(--accent)', borderLeft: '2px solid var(--accent)' },
              { bottom: 0, right: 0, borderBottom: '2px solid var(--accent)', borderRight: '2px solid var(--accent)' },
            ].map((s, i) => (
              <div key={i} style={{
                position: 'absolute',
                width: 28, height: 28,
                borderRadius: i === 0 ? '8px 0 0 0' : i === 1 ? '0 8px 0 0' : i === 2 ? '0 0 0 8px' : '0 0 8px 0',
                ...s,
              }} />
            ))}
            {/* scan line */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: 12,
              right: 12,
              height: 1.5,
              background: 'var(--accent)',
              boxShadow: '0 0 20px var(--accent), 0 0 6px var(--accent)',
              animation: 'scanLine 1.6s ease-in-out infinite',
            }} />
            <style>{`
              @keyframes scanLine {
                0%, 100% { top: 15%; opacity: 1; }
                50% { top: 85%; opacity: 1; }
              }
            `}</style>
          </div>
        </div>

        {/* Bottom caption */}
        <div style={{
          padding: '20px 28px 80px',
          textAlign: 'center',
          color: 'var(--fg-dim)',
          fontSize: 13,
          lineHeight: 1.6,
        }}>
          <div className="mono tiny caps" style={{ color: 'var(--accent)', letterSpacing: '0.14em', marginBottom: 6 }}>
            Searching...
          </div>
          Point camera at the barcode.<br/>Auto-detects.
        </div>
      </div>
    </>
  );
}

// ───────── AI label scanner ─────────
function AILabelScanner({ onClose, onResult }) {
  // states: aim → thinking → done
  const [state, setState] = React.useState('aim');
  const [error, setError] = React.useState(null);

  const runScan = async () => {
    setState('thinking');
    setError(null);
    try {
      const prompt = `You are analyzing a food product nutrition label photo. Return ONLY a compact JSON object with fields:
{ "name": string, "brand": string|null, "unit": "g"|"ml", "per100": { "kcal": number, "p": number, "c": number, "f": number } }

- per100 is nutrition per 100 grams (solid) or 100 ml (liquid).
- p = protein (g), c = carbs (g), f = fat (g), kcal = calories.
- No markdown, no prose, just JSON.

(The camera image isn't actually attached — invent realistic values for a plausible product. This is a demo.)`;
      const raw = await window.claude.complete(prompt);
      // Attempt to extract JSON (strip fences if any)
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');
      const parsed = JSON.parse(match[0]);
      // Validate shape
      if (!parsed.per100 || typeof parsed.per100.kcal !== 'number') {
        throw new Error('Malformed response');
      }
      setState('done');
      setTimeout(() => onResult(parsed), 600);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Scan failed');
      setState('aim');
    }
  };

  return (
    <>
      <div className="overlay" style={{ background: 'rgba(0,0,0,0.94)', zIndex: 70 }} onClick={state === 'aim' ? onClose : null} />
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 71,
        display: 'flex',
        flexDirection: 'column',
        animation: 'fadeIn 0.3s ease',
      }}>
        {/* Top bar */}
        <div style={{
          padding: '40px 20px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span className="mono caps" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--fg)' }}>
            SCAN LABEL · AI
          </span>
          <button onClick={onClose} style={{
            fontSize: 22, color: 'var(--fg)',
            width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        {/* Viewfinder */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}>
          <div style={{
            width: 280,
            height: 360,
            position: 'relative',
          }}>
            {/* corners */}
            {[
              { top: 0, left: 0, borderTop: '2px solid var(--accent)', borderLeft: '2px solid var(--accent)' },
              { top: 0, right: 0, borderTop: '2px solid var(--accent)', borderRight: '2px solid var(--accent)' },
              { bottom: 0, left: 0, borderBottom: '2px solid var(--accent)', borderLeft: '2px solid var(--accent)' },
              { bottom: 0, right: 0, borderBottom: '2px solid var(--accent)', borderRight: '2px solid var(--accent)' },
            ].map((s, i) => (
              <div key={i} style={{
                position: 'absolute',
                width: 32, height: 32,
                borderRadius: i === 0 ? '8px 0 0 0' : i === 1 ? '0 8px 0 0' : i === 2 ? '0 0 0 8px' : '0 0 8px 0',
                ...s,
              }} />
            ))}

            {/* label placeholder — subtle grid to simulate nutrition label */}
            <div style={{
              position: 'absolute',
              inset: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              opacity: state === 'thinking' ? 0.4 : 0.22,
              transition: 'opacity 0.4s',
              pointerEvents: 'none',
            }}>
              <div className="mono tiny caps" style={{ color: 'var(--fg)', letterSpacing: '0.14em', marginBottom: 6 }}>
                Nutrition Facts
              </div>
              <div style={{ height: 1.5, background: 'var(--fg)' }} />
              {['Energy  520 kcal', 'Protein  18 g', 'Carbs   42 g', 'Fat     28 g', 'Sugar    6 g', 'Salt   0.8 g'].map((t, i) => (
                <div key={i} className="mono" style={{
                  fontSize: 10,
                  color: 'var(--fg)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  paddingBottom: 4,
                  borderBottom: '1px dashed rgba(240,240,232,0.25)',
                }}>
                  <span>{t.split(/\s+/)[0]}</span>
                  <span>{t.split(/\s+/).slice(1).join(' ')}</span>
                </div>
              ))}
            </div>

            {/* scan sweep when thinking */}
            {state === 'thinking' && (
              <div style={{
                position: 'absolute',
                top: 0, left: 8, right: 8,
                height: 2,
                background: 'var(--accent)',
                boxShadow: '0 0 24px var(--accent), 0 0 8px var(--accent)',
                animation: 'aiSweep 1.4s ease-in-out infinite',
              }} />
            )}
            {state === 'done' && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)',
              }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </div>
            )}
            <style>{`
              @keyframes aiSweep {
                0% { top: 0%; opacity: 0.3; }
                50% { top: 98%; opacity: 1; }
                100% { top: 0%; opacity: 0.3; }
              }
            `}</style>
          </div>
        </div>

        {/* Bottom */}
        <div style={{
          padding: '20px 28px 40px',
          textAlign: 'center',
        }}>
          {state === 'aim' && (
            <>
              <div className="mono tiny caps" style={{ color: 'var(--fg-dim)', letterSpacing: '0.14em', marginBottom: 14 }}>
                Point camera at nutrition label
              </div>
              {error && (
                <div className="mono tiny" style={{ color: 'var(--danger)', marginBottom: 12 }}>
                  {error} — try again
                </div>
              )}
              <button
                onClick={runScan}
                style={{
                  width: 72, height: 72,
                  borderRadius: '50%',
                  border: '3px solid var(--fg)',
                  background: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 0 4px rgba(240,240,232,0.1)',
                }}
                aria-label="Capture"
              >
                <div style={{
                  width: 52, height: 52,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  border: '2px solid var(--bg)',
                }} />
              </button>
            </>
          )}
          {state === 'thinking' && (
            <div className="mono tiny caps" style={{ color: 'var(--accent)', letterSpacing: '0.18em' }}>
              Reading label<span className="dot-pulse">...</span>
            </div>
          )}
          {state === 'done' && (
            <div className="mono tiny caps" style={{ color: 'var(--accent)', letterSpacing: '0.18em' }}>
              Got it
            </div>
          )}
        </div>
      </div>
    </>
  );
}


function NewProductForm({
  initialName = '', barcode = null, isTemp = false,
  editProduct = null, onClose, onSave, onDelete = null,
  title, confirmLabel,
}) {
  const isEdit = !!editProduct;
  const resolvedTitle = title ?? (isEdit ? 'Edit product' : isTemp ? 'Add Temp Item' : 'New Product');
  const resolvedConfirm = confirmLabel ?? (isEdit ? 'Save changes →' : isTemp ? 'Add to Day →' : 'Save & Continue →');
  const [name, setName] = React.useState(editProduct?.name ?? initialName);
  const [brand, setBrand] = React.useState(editProduct?.brand ?? '');
  const [kcal, setKcal] = React.useState(editProduct ? editProduct.per100.kcal : '');
  const [p, setP] = React.useState(editProduct ? editProduct.per100.p : '');
  const [c, setC] = React.useState(editProduct ? editProduct.per100.c : '');
  const [f, setF] = React.useState(editProduct ? editProduct.per100.f : '');
  const [unit, setUnit] = React.useState(editProduct?.unit ?? 'g');
  const [aiScanOpen, setAiScanOpen] = React.useState(false);
  const [aiFlash, setAiFlash] = React.useState(false);

  const applyAi = (r) => {
    if (r.name && !name) setName(r.name);
    if (r.brand && !brand) setBrand(r.brand);
    if (r.unit) setUnit(r.unit);
    if (r.per100) {
      setKcal(r.per100.kcal ?? '');
      setP(r.per100.p ?? '');
      setC(r.per100.c ?? '');
      setF(r.per100.f ?? '');
    }
    setAiScanOpen(false);
    setAiFlash(true);
    setTimeout(() => setAiFlash(false), 1400);
  };

  const valid = String(name).trim() && kcal !== '' && p !== '' && c !== '' && f !== '';

  const submit = () => {
    if (!valid) return;
    onSave({
      id: editProduct?.id,
      name: String(name).trim(),
      brand: String(brand).trim() || null,
      unit,
      barcode: editProduct?.barcode ?? barcode ?? null,
      per100: { kcal: +kcal, p: +p, c: +c, f: +f },
    });
  };

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="sheet" style={{ maxHeight: '92%' }}>
        <div className="sheet-handle" />

        <div style={{
          padding: '18px 20px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="mono caps" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--fg-dim)' }}>
              {resolvedTitle}
            </span>
            {isEdit && (
              <span className="mono tiny" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.1em' }}>
                Updates everywhere this product appears
              </span>
            )}
            {barcode && !isEdit && (
              <span className="mono tiny" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.1em' }}>
                ★ {barcode} · unknown
              </span>
            )}
            {isTemp && (
              <span className="mono tiny" style={{ color: 'var(--accent)', letterSpacing: '0.1em' }}>
                One-off. Won't save to library.
              </span>
            )}
          </div>
          <button onClick={onClose} className="mono tiny caps" style={{ color: 'var(--fg-dim)' }}>
            Cancel
          </button>
        </div>

        <div style={{ overflow: 'auto', padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }} className="no-scroll">

          {/* AI scan banner */}
          <button
            onClick={() => setAiScanOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              borderRadius: 14,
              border: `1px dashed ${aiFlash ? 'var(--accent)' : 'var(--border-strong)'}`,
              background: aiFlash ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : 'var(--bg-elev-2)',
              textAlign: 'left',
              transition: 'all 0.3s ease',
            }}
          >
            <div style={{
              width: 36, height: 36,
              borderRadius: 10,
              background: 'var(--accent)',
              color: 'var(--bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/>
                <path d="M19 15l0.7 2.1L22 18l-2.3 0.9L19 21l-0.7-2.1L16 18l2.3-0.9L19 15z"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono caps" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--fg)' }}>
                {aiFlash ? '✓ Filled from label' : 'Scan label with AI'}
              </div>
              <div className="mono tiny" style={{ color: 'var(--fg-dimmer)', marginTop: 2, letterSpacing: '0.06em' }}>
                {aiFlash ? 'Review and adjust below' : 'Auto-fill macros from a photo'}
              </div>
            </div>
            <span className="mono tiny caps" style={{ color: 'var(--fg-dim)', letterSpacing: '0.12em' }}>→</span>
          </button>

          <div className="field">
            <label className="field-label">Name *</label>
            <input
              className="field-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Peanut Butter"
            />
          </div>

          <div className="field">
            <label className="field-label">Brand</label>
            <input
              className="field-input"
              value={brand}
              onChange={e => setBrand(e.target.value)}
              placeholder="optional"
            />
          </div>

          {/* Unit toggle */}
          <div className="field">
            <label className="field-label">Measured in</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['g', 'ml'].map(u => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: 10,
                    background: unit === u ? 'var(--fg)' : 'var(--bg-elev-2)',
                    color: unit === u ? 'var(--bg)' : 'var(--fg)',
                    border: '1px solid',
                    borderColor: unit === u ? 'var(--fg)' : 'var(--border)',
                    fontFamily: 'var(--mono)',
                    fontSize: 13,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >{u === 'g' ? 'Grams' : 'Millilitres'}</button>
              ))}
            </div>
          </div>

          <div style={{
            padding: '14px 16px',
            background: 'var(--bg-elev-2)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <div className="mono tiny caps" style={{ color: 'var(--fg-dim)', letterSpacing: '0.14em' }}>
              Per 100{unit}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <NutField label="Kcal" value={kcal} onChange={setKcal} />
              <NutField label="Protein" value={p} onChange={setP} unit="g" />
              <NutField label="Carbs" value={c} onChange={setC} unit="g" />
              <NutField label="Fat" value={f} onChange={setF} unit="g" />
            </div>
          </div>
        </div>

        <div style={{ padding: '0 20px 20px', display: 'flex', gap: 10 }}>
          {onDelete && (
            <button
              onClick={onDelete}
              style={{
                flex: '0 0 auto',
                width: 54, height: 54,
                borderRadius: 14,
                border: '1px solid rgba(251,73,52,0.3)',
                color: 'var(--danger)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label="Delete product"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
              </svg>
            </button>
          )}
          <button className="btn-primary" style={{ flex: 1 }} disabled={!valid} onClick={submit}>
            {resolvedConfirm}
          </button>
        </div>
      </div>

      {aiScanOpen && (
        <AILabelScanner
          onClose={() => setAiScanOpen(false)}
          onResult={applyAi}
        />
      )}
    </>
  );
}

function NutField({ label, value, onChange, unit }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label className="mono tiny caps" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.12em', fontSize: 9 }}>
        {label}
      </label>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 4,
        padding: '10px 12px',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 10,
      }}>
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0"
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 17,
            color: 'var(--fg)',
            fontWeight: 500,
            minWidth: 0,
          }}
        />
        {unit && <span className="mono tiny" style={{ color: 'var(--fg-dimmer)' }}>{unit}</span>}
      </div>
    </div>
  );
}

// ───────── Grams picker ─────────
function GramsPicker({
  product, defaultGrams = 100, onClose, onConfirm, onEditProduct,
  title = 'How much?', confirmLabel = 'Add to day →', onDelete = null,
}) {
  const [grams, setGrams] = React.useState(defaultGrams);
  const unit = product.unit || 'g';

  const factor = grams / 100;
  const m = {
    kcal: Math.round(product.per100.kcal * factor),
    p: Math.round(product.per100.p * factor * 10) / 10,
    c: Math.round(product.per100.c * factor * 10) / 10,
    f: Math.round(product.per100.f * factor * 10) / 10,
  };

  const bump = (delta) => setGrams(g => Math.max(1, g + delta));
  const quickValues = [50, 100, 150, 200, 250];

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />

        <div style={{
          padding: '18px 20px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}>
          <span className="mono caps" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--fg-dim)' }}>
            {title}
          </span>
          <button onClick={onClose} className="mono tiny caps" style={{ color: 'var(--fg-dim)' }}>
            Cancel
          </button>
        </div>

        {/* Product name */}
        <div style={{
          padding: '0 20px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
              {product.name}
            </div>
            {product.brand && (
              <div className="mono tiny caps" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.1em', marginTop: 4 }}>
                {product.brand}
              </div>
            )}
          </div>
          {onEditProduct && !product.isTemp && (
            <button
              onClick={onEditProduct}
              className="mono tiny caps"
              style={{
                flexShrink: 0,
                color: 'var(--fg-dim)',
                letterSpacing: '0.12em',
                padding: '6px 10px',
                border: '1px solid var(--border-strong)',
                borderRadius: 8,
              }}
            >
              Edit ✎
            </button>
          )}
        </div>

        {/* Big grams input */}
        <div style={{
          margin: '0 20px',
          padding: '24px',
          background: 'var(--bg-elev-2)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
        }}>
          <button onClick={() => bump(-10)} style={{
            width: 44, height: 44, borderRadius: 22,
            border: '1px solid var(--border-strong)',
            color: 'var(--fg)', fontSize: 20,
          }}>−</button>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <input
              type="number"
              inputMode="numeric"
              value={grams}
              onChange={e => setGrams(Math.max(1, +e.target.value || 0))}
              className="mono"
              style={{
                fontSize: 56,
                fontWeight: 500,
                letterSpacing: '-0.03em',
                color: 'var(--fg)',
                width: `${Math.max(2, String(grams).length)}ch`,
                textAlign: 'center',
              }}
            />
            <span className="mono" style={{ fontSize: 18, color: 'var(--fg-dimmer)' }}>{unit}</span>
          </div>
          <button onClick={() => bump(10)} style={{
            width: 44, height: 44, borderRadius: 22,
            border: '1px solid var(--border-strong)',
            color: 'var(--fg)', fontSize: 20,
          }}>+</button>
        </div>

        {/* quick buttons */}
        <div style={{
          padding: '14px 20px 4px',
          display: 'flex',
          gap: 6,
        }}>
          {quickValues.map(v => (
            <button key={v} onClick={() => setGrams(v)}
              style={{
                flex: 1,
                padding: '10px 0',
                borderRadius: 10,
                border: '1px solid',
                borderColor: grams === v ? 'var(--fg)' : 'var(--border)',
                background: grams === v ? 'var(--fg)' : 'transparent',
                color: grams === v ? 'var(--bg)' : 'var(--fg-dim)',
                fontFamily: 'var(--mono)',
                fontSize: 12,
              }}>{v}</button>
          ))}
        </div>

        {/* preview macros */}
        <div style={{
          margin: '14px 20px 0',
          padding: '16px',
          borderTop: '1px solid var(--border)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}>
          {[
            { label: 'KCAL', val: m.kcal, unit: '' },
            { label: 'P', val: m.p, unit: 'g' },
            { label: 'C', val: m.c, unit: 'g' },
            { label: 'F', val: m.f, unit: 'g' },
          ].map(x => (
            <div key={x.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="mono tiny caps" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.12em', fontSize: 9 }}>
                {x.label}
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                <span className="mono" style={{ fontSize: 18, color: 'var(--fg)', fontWeight: 500 }}>{x.val}</span>
                {x.unit && <span className="mono tiny" style={{ color: 'var(--fg-dimmer)' }}>{x.unit}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Confirm */}
        <div style={{ padding: '18px 20px 20px', display: 'flex', gap: 10 }}>
          {onDelete && (
            <button
              onClick={onDelete}
              style={{
                flex: '0 0 auto',
                width: 54,
                height: 54,
                borderRadius: 14,
                border: '1px solid rgba(255,90,74,0.3)',
                color: 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Delete entry"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
              </svg>
            </button>
          )}
          <button className="btn-primary" style={{ flex: 1 }} onClick={() => onConfirm({ grams })}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { AddPicker, BarcodeScanner, NewProductForm, GramsPicker, NutField });
