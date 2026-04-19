// Main app shell

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#b8bb26",
  "startScreen": "home",
  "fontPair": "geist-jb"
}/*EDITMODE-END*/;

const FONT_PAIRS = {
  'geist-jb':    { name: 'Geist × JetBrains',  sans: "'Geist', -apple-system, system-ui, sans-serif",        mono: "'JetBrains Mono', ui-monospace, monospace" },
  'plex':        { name: 'IBM Plex',           sans: "'IBM Plex Sans', system-ui, sans-serif",                mono: "'IBM Plex Mono', ui-monospace, monospace" },
  'grotesk':     { name: 'Space Grotesk',      sans: "'Space Grotesk', system-ui, sans-serif",                mono: "'Space Mono', ui-monospace, monospace" },
  'dm':          { name: 'DM Sans × DM Mono',  sans: "'DM Sans', system-ui, sans-serif",                      mono: "'DM Mono', ui-monospace, monospace" },
  'serif-fira':  { name: 'Instrument × Fira',  sans: "'Instrument Serif', Georgia, serif",                    mono: "'Fira Code', ui-monospace, monospace" },
  'syne-jb':     { name: 'Syne × JetBrains',   sans: "'Syne', system-ui, sans-serif",                         mono: "'JetBrains Mono', ui-monospace, monospace" },
};

function App() {
  // Gruvbox accent palette by consumption ratio
  const ACCENT_GREEN  = '#b8bb26';
  const ACCENT_YELLOW = '#fabd2f';
  const ACCENT_ORANGE = '#fe8019';
  const ACCENT_RED    = '#fb4934';

  const pickAccentFor = (ratio) => {
    if (ratio >= 1)     return ACCENT_RED;
    if (ratio >= 2 / 3) return ACCENT_ORANGE;
    if (ratio >= 1 / 3) return ACCENT_YELLOW;
    return ACCENT_GREEN;
  };

  // Apply tweak color + fonts
  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent', TWEAK_DEFAULTS.accent);
    const pair = FONT_PAIRS[TWEAK_DEFAULTS.fontPair] || FONT_PAIRS['geist-jb'];
    document.documentElement.style.setProperty('--sans', pair.sans);
    document.documentElement.style.setProperty('--mono', pair.mono);
  }, []);

  // Edit mode plumbing
  const [tweaksOpen, setTweaksOpen] = React.useState(false);
  React.useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === '__activate_edit_mode') setTweaksOpen(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  // Auth
  const [loggedIn, setLoggedIn] = React.useState(TWEAK_DEFAULTS.startScreen === 'home');
  const [userEmail, setUserEmail] = React.useState('ben@kcal.app');

  // State
  const [products, setProducts] = React.useState(SEED_PRODUCTS);
  const [goals, setGoals] = React.useState(DEFAULT_GOALS);
  const [recents, setRecents] = React.useState(['p1', 'p2', 'p3', 'p4', 'p5', 'p9']);

  // Seed entries under today's date key
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const [entriesByDate, setEntriesByDate] = React.useState(() => ({
    [todayKey]: SEED_ENTRIES,
  }));

  const [selectedDate, setSelectedDate] = React.useState(today);

  // Dynamic accent based on today's kcal consumption ratio
  React.useEffect(() => {
    const todays = entriesByDate[todayKey] || [];
    const todayTotals = computeTotals(todays, products);
    const ratio = goals.kcal > 0 ? todayTotals.kcal / goals.kcal : 0;
    document.documentElement.style.setProperty('--accent', pickAccentFor(ratio));
  }, [entriesByDate, products, goals, todayKey]);

  // Modal stack
  const [modal, setModal] = React.useState(null);
  // 'picker' | 'scan' | 'new-product' | 'grams' | 'settings'
  const [modalData, setModalData] = React.useState({});

  // Print-mode: open a specific modal on load based on URL hash
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const screen = params.get('screen');
    if (!screen) return;
    // slight delay so seed data is in place
    setTimeout(() => {
      if (screen === 'login') { setLoggedIn(false); return; }
      if (screen === 'home') { return; }
      if (screen === 'picker') { setModal('picker'); return; }
      if (screen === 'scan') { setModal('scan'); return; }
      if (screen === 'new-product') {
        setModal('new-product');
        setModalData({ initialName: 'Greek Yogurt', isTemp: false });
        return;
      }
      if (screen === 'grams') {
        setModal('grams');
        setModalData({ product: SEED_PRODUCTS[0], defaultGrams: 150 });
        return;
      }
      if (screen === 'settings') { setModal('settings'); return; }
    }, 50);
  }, []);

  // Expose products for components-shared
  React.useEffect(() => { window.__allProducts = products; }, [products]);

  // Handlers
  const handlePickProduct = (p) => {
    setModal('grams');
    setModalData({ product: p });
  };
  const handleEditEntry = (entry) => {
    const prod = entry.tempProduct || products.find(p => p.id === entry.productId);
    if (!prod) return;
    setModal('grams');
    setModalData({ product: prod, editingEntryId: entry.id, defaultGrams: entry.grams });
  };
  const handleScan = () => setModal('scan');
  const handleBarcode = (code) => {
    setModal('new-product');
    setModalData({ barcode: code, initialName: '' });
  };
  const handleAddNew = (name) => {
    setModal('new-product');
    setModalData({ initialName: name, isTemp: false });
  };
  const handleAddTemp = (name) => {
    setModal('new-product');
    setModalData({ initialName: name, isTemp: true });
  };
  const handleNewProductSaved = (data) => {
    // Editing an existing product in library?
    if (data.id && products.some(p => p.id === data.id)) {
      const updated = { ...products.find(p => p.id === data.id), ...data };
      setProducts(ps => ps.map(p => p.id === data.id ? updated : p));
      // If we came from grams picker, go back to it with the updated product
      if (modalData.returnToGrams) {
        setModal('grams');
        setModalData({
          product: updated,
          editingEntryId: modalData.returnToGrams.editingEntryId,
          defaultGrams: modalData.returnToGrams.defaultGrams,
        });
      } else {
        setModal(null);
        setModalData({});
      }
      return;
    }
    if (modalData.isTemp) {
      // Temp — skip to grams picker with a temp product
      const tempProduct = { ...data, id: `temp-${Date.now()}`, isTemp: true };
      setModal('grams');
      setModalData({ product: tempProduct, isTemp: true });
    } else {
      // Save to library + continue to grams
      const newProduct = { ...data, id: `p-${Date.now()}` };
      setProducts(ps => [newProduct, ...ps]);
      setRecents(r => [newProduct.id, ...r.filter(x => x !== newProduct.id)].slice(0, 10));
      setModal('grams');
      setModalData({ product: newProduct });
    }
  };
  const handleEditProduct = (product) => {
    // Remember where to return afterwards
    setModal('new-product');
    setModalData({
      editProduct: product,
      returnToGrams: {
        editingEntryId: modalData.editingEntryId,
        defaultGrams: modalData.defaultGrams,
      },
    });
  };
  const handleDeleteProduct = (productId) => {
    setProducts(ps => ps.filter(p => p.id !== productId));
    setRecents(r => r.filter(x => x !== productId));
    // Also remove any entries referencing it across all days
    setEntriesByDate(e => {
      const next = {};
      for (const [k, list] of Object.entries(e)) {
        next[k] = list.filter(x => x.productId !== productId);
      }
      return next;
    });
    setModal(null);
    setModalData({});
  };
  const handleGramsConfirm = ({ grams }) => {
    const prod = modalData.product;
    const dateKey = selectedDate.toISOString().slice(0, 10);
    if (modalData.editingEntryId) {
      setEntriesByDate(e => ({
        ...e,
        [dateKey]: (e[dateKey] || []).map(x =>
          x.id === modalData.editingEntryId ? { ...x, grams } : x
        ),
      }));
      setModal(null);
      setModalData({});
      return;
    }
    const time = new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 5);
    const entry = {
      id: `e-${Date.now()}`,
      productId: prod.isTemp ? null : prod.id,
      tempProduct: prod.isTemp ? prod : null,
      grams,
      time,
    };
    setEntriesByDate(e => ({
      ...e,
      [dateKey]: [...(e[dateKey] || []), entry],
    }));
    if (!prod.isTemp) {
      setRecents(r => [prod.id, ...r.filter(x => x !== prod.id)].slice(0, 10));
    }
    setModal(null);
    setModalData({});
  };
  const handleDelete = (entryId) => {
    const dateKey = selectedDate.toISOString().slice(0, 10);
    setEntriesByDate(e => ({
      ...e,
      [dateKey]: (e[dateKey] || []).filter(x => x.id !== entryId),
    }));
  };

  if (!loggedIn) {
    return <LoginScreen onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <>
      <HomeScreen
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        entriesByDate={entriesByDate}
        products={products}
        goals={goals}
        onAdd={() => setModal('picker')}
        onSettings={() => setModal('settings')}
        onDelete={handleDelete}
        onEntryClick={handleEditEntry}
      />

      {modal === 'picker' && (
        <AddPicker
          products={products}
          recents={recents}
          onClose={() => setModal(null)}
          onPickProduct={handlePickProduct}
          onScan={handleScan}
          onAddNew={handleAddNew}
          onAddTemp={handleAddTemp}
        />
      )}

      {modal === 'scan' && (
        <BarcodeScanner
          onClose={() => setModal('picker')}
          onScan={handleBarcode}
        />
      )}

      {modal === 'new-product' && (
        <NewProductForm
          initialName={modalData.initialName}
          barcode={modalData.barcode}
          isTemp={modalData.isTemp}
          editProduct={modalData.editProduct}
          onClose={() => {
            if (modalData.editProduct && modalData.returnToGrams) {
              setModal('grams');
              setModalData({
                product: modalData.editProduct,
                editingEntryId: modalData.returnToGrams.editingEntryId,
                defaultGrams: modalData.returnToGrams.defaultGrams,
              });
            } else {
              setModal('picker');
              setModalData({});
            }
          }}
          onSave={handleNewProductSaved}
          onDelete={modalData.editProduct ? () => handleDeleteProduct(modalData.editProduct.id) : null}
        />
      )}

      {modal === 'grams' && modalData.product && (
        <GramsPicker
          product={modalData.product}
          defaultGrams={modalData.defaultGrams || 100}
          title={modalData.editingEntryId ? 'Edit entry' : 'How much?'}
          confirmLabel={modalData.editingEntryId ? 'Save changes →' : 'Add to day →'}
          onDelete={modalData.editingEntryId ? () => {
            handleDelete(modalData.editingEntryId);
            setModal(null);
            setModalData({});
          } : null}
          onEditProduct={() => handleEditProduct(modalData.product)}
          onClose={() => { setModal(modalData.editingEntryId ? null : 'picker'); setModalData({}); }}
          onConfirm={handleGramsConfirm}
        />
      )}

      {modal === 'settings' && (
        <SettingsScreen
          goals={goals}
          userEmail={userEmail}
          onSave={(g) => { setGoals(g); setModal(null); }}
          onClose={() => setModal(null)}
          onLogout={() => { setLoggedIn(false); setModal(null); }}
        />
      )}

      {tweaksOpen && (
        <TweaksPanel
          onClose={() => setTweaksOpen(false)}
        />
      )}
    </>
  );
}

function TweaksPanel({ onClose }) {
  const [accent, setAccent] = React.useState(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  const [fontPair, setFontPair] = React.useState(TWEAK_DEFAULTS.fontPair);
  const colors = [
    { name: 'Green',   v: '#b8bb26' },
    { name: 'Yellow',  v: '#fabd2f' },
    { name: 'Orange',  v: '#fe8019' },
    { name: 'Red',     v: '#fb4934' },
    { name: 'Aqua',    v: '#8ec07c' },
    { name: 'Blue',    v: '#83a598' },
    { name: 'Purple',  v: '#d3869b' },
  ];
  const applyColor = (v) => {
    setAccent(v);
    document.documentElement.style.setProperty('--accent', v);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { accent: v } }, '*');
  };
  const applyFont = (key) => {
    setFontPair(key);
    const pair = FONT_PAIRS[key];
    document.documentElement.style.setProperty('--sans', pair.sans);
    document.documentElement.style.setProperty('--mono', pair.mono);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { fontPair: key } }, '*');
  };
  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      right: 16,
      background: 'var(--bg-elev)',
      border: '1px solid var(--border-strong)',
      borderRadius: 16,
      padding: 14,
      zIndex: 100,
      width: 260,
      boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
      fontFamily: 'var(--sans)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="mono tiny caps" style={{ color: 'var(--fg)', letterSpacing: '0.16em' }}>Tweaks</span>
        <button onClick={onClose} style={{ color: 'var(--fg-dim)', fontSize: 16 }}>×</button>
      </div>

      <div className="mono tiny caps" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.12em', marginBottom: 8 }}>Accent</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 14 }}>
        {colors.map(c => (
          <button key={c.v} onClick={() => applyColor(c.v)}
            style={{
              height: 28, borderRadius: 8,
              background: c.v,
              border: accent === c.v ? '2px solid #fff' : '2px solid transparent',
            }}
            title={c.name}
          />
        ))}
      </div>

      <div className="mono tiny caps" style={{ color: 'var(--fg-dimmer)', letterSpacing: '0.12em', marginBottom: 8 }}>Font pair</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Object.entries(FONT_PAIRS).map(([key, pair]) => {
          const active = fontPair === key;
          return (
            <button key={key} onClick={() => applyFont(key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: 8,
                background: active ? 'var(--bg-elev-2)' : 'transparent',
                border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
                textAlign: 'left',
              }}>
              <span style={{ fontFamily: pair.sans, fontSize: 13, color: 'var(--fg)' }}>
                {pair.name}
              </span>
              <span style={{ fontFamily: pair.mono, fontSize: 11, color: active ? 'var(--accent)' : 'var(--fg-dimmer)' }}>
                2400
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
