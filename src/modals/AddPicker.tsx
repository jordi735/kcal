// AddPicker — server-side search + recents + actions (scan barcode / create new product).

import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Product } from '../types';
import { api } from '../api';
import { Sheet, useSheetClose } from '../components/Sheet';
import { PlusIcon } from '../components/Icon';
import styles from './AddPicker.module.css';

export type AddPickerProps = {
  onPick: (product: Product) => void;
  onCreateNew: (name: string) => void;
  onAddTemp: (name: string) => void;
  onScanBarcode: () => void;
  onClose: () => void;
  addedProductIds: ReadonlySet<number>;
};

export function AddPicker(props: AddPickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <Sheet onClose={props.onClose} style={{ ['--sheet-height' as any]: '80%' }} scrollRef={scrollRef}>
      <AddPickerInner {...props} scrollRef={scrollRef} />
    </Sheet>
  );
}

type InnerProps = Omit<AddPickerProps, 'onClose'> & {
  scrollRef: RefObject<HTMLDivElement>;
};

function AddPickerInner({
  onPick,
  onCreateNew,
  onAddTemp,
  onScanBarcode,
  addedProductIds,
  scrollRef,
}: InnerProps) {
  const close = useSheetClose();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [recents, setRecents] = useState<Product[] | null>(null);
  const [allProducts, setAllProducts] = useState<Product[] | null>(null);
  const [results, setResults] = useState<Product[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<Product[]>('/products/recent');
        if (!cancelled) setRecents(data);
      } catch {
        if (!cancelled) setRecents([]);
      }
    })();
    (async () => {
      try {
        const data = await api<Product[]>('/products/all');
        if (!cancelled) setAllProducts(data);
      } catch {
        if (!cancelled) setAllProducts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const trimmed = debouncedQ.trim();
    if (trimmed === '') {
      setResults(null);
      return;
    }
    let cancelled = false;
    setResults(null);
    (async () => {
      try {
        const data = await api<Product[]>(
          `/products/search?q=${encodeURIComponent(trimmed)}`,
        );
        if (!cancelled) setResults(data);
      } catch {
        if (!cancelled) setResults([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQ]);

  const trimmed = q.trim();
  const showingSearch = trimmed.length > 0;
  const idleLoading = !showingSearch && (recents === null || allProducts === null);
  const searchLoading = showingSearch && results === null;
  const emptySearch = showingSearch && results !== null && results.length === 0;
  const recentIds = new Set((recents ?? []).map((p) => p.id));
  const allMinusRecents = (allProducts ?? []).filter((p) => !recentIds.has(p.id));
  const idleEmpty =
    !showingSearch &&
    recents !== null &&
    allProducts !== null &&
    recents.length === 0 &&
    allProducts.length === 0;

  const renderRow = (p: Product) => {
    const added = addedProductIds.has(p.id);
    return (
      <button key={p.id} onClick={() => onPick(p)} className={styles.row}>
        <div className={styles.rowInfo}>
          <div className={`${styles.rowName}${added ? ` ${styles.rowNameAdded}` : ''}`}>
            <span className={styles.rowNameText}>{p.name}</span>
            {added && (
              <span className={`mono tiny caps ${styles.addedBadge}`}>ADDED</span>
            )}
          </div>
          {p.brand && (
            <div className={`mono tiny ${styles.rowBrand}`}>{p.brand.toUpperCase()}</div>
          )}
        </div>
        <div className={styles.rowMacros}>
          <span className={`mono ${styles.rowKcal}`}>{Math.round(p.per100.kcal)}</span>
          <span className={`mono tiny ${styles.rowBreakdown}`}>
            P{Math.round(p.per100.protein)} C{Math.round(p.per100.carbs)} F{Math.round(p.per100.fat)}
          </span>
        </div>
      </button>
    );
  };

  const sectionHeader = (label: string) => (
    <div className={styles.sectionHeader}>
      <span className={`mono tiny caps ${styles.sectionLabel}`}>{label}</span>
      <span className={`mono tiny caps ${styles.sectionLabel}`}>per 100g</span>
    </div>
  );

  return (
    <>
      <div className={styles.header}>
        <span className={`mono caps ${styles.title}`}>Add Food</span>
        <button onClick={close} className={`mono tiny caps ${styles.cancelBtn}`}>
          Cancel
        </button>
      </div>

      <div className={styles.searchBar}>
        <div className={styles.searchBox}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={styles.searchIcon}
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            placeholder="Search products..."
            value={q}
            onInput={(e) => setQ(e.currentTarget.value)}
            className={styles.searchInput}
          />
          {q && (
            <button onClick={() => setQ('')} className={styles.clearBtn}>
              ×
            </button>
          )}
        </div>
        <button onClick={onScanBarcode} className={styles.scanBtn} aria-label="Scan barcode">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 7V5a2 2 0 012-2h2M4 17v2a2 2 0 002 2h2M16 3h2a2 2 0 012 2v2M16 21h2a2 2 0 002-2v-2" />
            <line x1="7" y1="8" x2="7" y2="16" />
            <line x1="10" y1="8" x2="10" y2="16" />
            <line x1="13" y1="8" x2="13" y2="16" />
            <line x1="17" y1="8" x2="17" y2="16" />
          </svg>
        </button>
      </div>

      <div ref={scrollRef} className={`no-scroll ${styles.list}`}>
        {showingSearch ? (
          searchLoading ? (
            <div className={`mono tiny caps ${styles.loadingMsg}`}>Searching...</div>
          ) : emptySearch ? (
            <div className={styles.emptyMsg}>
              <div className={`mono ${styles.emptyQuery}`}>"{q}"</div>
              not in your library yet.
            </div>
          ) : (
            <>
              {sectionHeader(
                `${results!.length} result${results!.length === 1 ? '' : 's'}`,
              )}
              {results!.map(renderRow)}
            </>
          )
        ) : idleLoading ? (
          <div className={`mono tiny caps ${styles.loadingMsg}`}>Loading...</div>
        ) : idleEmpty ? (
          <div className={styles.emptyMsg}>
            Your library is empty. Tap + Add New to create your first product.
          </div>
        ) : (
          <>
            {recents!.length > 0 && (
              <>
                {sectionHeader('Recent')}
                {recents!.map(renderRow)}
              </>
            )}
            {allMinusRecents.length > 0 && (
              <>
                {sectionHeader('All')}
                {allMinusRecents.map(renderRow)}
              </>
            )}
          </>
        )}
      </div>

      <div className={styles.footer}>
        <button
          onClick={() => onAddTemp(q)}
          className={`btn-secondary ${styles.tempBtn}`}
        >
          <PlusIcon size={14} />
          Add Temp
        </button>
        <button
          onClick={() => onCreateNew(q)}
          className={`btn-primary ${styles.addNewBtn}`}
        >
          <PlusIcon size={14} />
          Add New
        </button>
      </div>
    </>
  );
}
