// AddPicker — server-side search + recents + actions (scan barcode / create new product).

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Product } from '../types';
import { api } from '../api';
import { cssVars } from '../styles';
import { MAX_PRODUCT_SEARCH_QUERY_LENGTH } from '../../shared/constraints';
import { MacroBreakdown } from '../components/MacroBreakdown';
import { Sheet, useSheetClose } from '../components/Sheet';
import { BarcodeIcon, CheckIcon, MagnifyingGlassIcon, PlusIcon, XMarkIcon } from '../components/Icon';
import styles from './AddPicker.module.css';

type PickerContentProps = {
  onPick: (product: Product) => void;
  refreshVersion: number;
  onRefreshError: () => void;
};

type AddActions = {
  onCreateNew: (name: string) => void;
  onAddTemp: (name: string) => void;
  onScanBarcode: () => void;
  addedProductIds: ReadonlySet<number>;
};

type AddPickerContentProps = PickerContentProps & (
  | ({ mode: 'add' } & AddActions)
  | { mode: 'replace'; onBack: () => void }
);

type AddPickerProps = PickerContentProps & AddActions & { onClose: () => void };

export function AddPicker({ onClose, ...contentProps }: AddPickerProps) {
  return (
    <Sheet onClose={onClose} style={cssVars({ '--sheet-height': '92%' })}>
      <AddPickerContent {...contentProps} mode="add" />
    </Sheet>
  );
}

type ProductLoad = {
  status: 'loading' | 'success' | 'error';
  products: Product[] | null;
};
const initialLoad: ProductLoad = { status: 'loading', products: null };

// Also renders as a local entry-editor subview, without nesting Sheets.
export function AddPickerContent(props: AddPickerContentProps) {
  const { onPick, refreshVersion, onRefreshError } = props;
  const close = useSheetClose();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [recents, setRecents] = useState<ProductLoad>(initialLoad);
  const [allProducts, setAllProducts] = useState<ProductLoad>(initialLoad);
  const [results, setResults] = useState<ProductLoad & { query: string; global: boolean }>({
    ...initialLoad, query: '', global: false,
  });
  const [libraryRetry, setLibraryRetry] = useState(0);
  const [searchRetry, setSearchRetry] = useState(0);
  // false = own library only (default). true = blended with the cross-user
  // barcoded catalog. Toggling retriggers the debounced-search effect.
  const [global, setGlobal] = useState(false);
  const refreshError = useRef(onRefreshError);
  refreshError.current = onRefreshError;
  const libraryVersion = useRef(refreshVersion);
  const searchRequest = useRef<{
    query: string;
    global: boolean;
    refreshVersion: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isRefresh = libraryVersion.current !== refreshVersion;
    libraryVersion.current = refreshVersion;
    const reportRefreshError = refreshError.current;
    setRecents((current) => ({ ...current, status: 'loading' }));
    setAllProducts((current) => ({ ...current, status: 'loading' }));
    (async () => {
      try {
        const data = await api<Product[]>('/products/recent');
        if (!cancelled) setRecents({ products: data, status: 'success' });
      } catch {
        if (!cancelled) {
          setRecents((current) => ({ ...current, status: 'error' }));
          if (isRefresh) reportRefreshError();
        }
      }
    })();
    (async () => {
      try {
        const data = await api<Product[]>('/products/all');
        if (!cancelled) setAllProducts({ products: data, status: 'success' });
      } catch {
        if (!cancelled) {
          setAllProducts((current) => ({ ...current, status: 'error' }));
          if (isRefresh) reportRefreshError();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshVersion, libraryRetry]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const tooLong = debouncedQ.length > MAX_PRODUCT_SEARCH_QUERY_LENGTH;
    const query = tooLong ? debouncedQ : debouncedQ.trim();
    const previous = searchRequest.current;
    const isRefresh = previous !== null && previous.refreshVersion !== refreshVersion;
    const reportRefreshError = refreshError.current;
    searchRequest.current = { query, global, refreshVersion };
    if (tooLong) {
      setResults({ query, global, status: 'error', products: null });
      return;
    }
    if (query === '') {
      setResults({ ...initialLoad, query, global });
      return;
    }
    let cancelled = false;
    setResults((current) => ({
      query, global, status: 'loading',
      products: current.query === query && current.global === global ? current.products : null,
    }));
    (async () => {
      try {
        const data = await api<Product[]>(
          `/products/search?q=${encodeURIComponent(query)}${global ? '&global=1' : ''}`,
        );
        if (!cancelled) setResults({ query, global, products: data, status: 'success' });
      } catch {
        if (!cancelled) {
          setResults((current) => ({ ...current, status: 'error' }));
          if (isRefresh) reportRefreshError();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, global, refreshVersion, searchRetry]);

  const query = q.length > MAX_PRODUCT_SEARCH_QUERY_LENGTH ? q : q.trim();
  const showingSearch = query.length > 0;
  // Query identity also protects the debounce window: an earlier result must
  // never be presented as a match for the newly typed query or selected scope.
  const search = results.query === query && results.global === global ? results : initialLoad;
  const recentProducts = recents.products ?? [];
  const recentIds = new Set(recentProducts.map((p) => p.id));
  const allMinusRecents = (allProducts.products ?? []).filter((p) => !recentIds.has(p.id));
  const libraryError = recents.status === 'error' || allProducts.status === 'error';
  const idleEmpty =
    !showingSearch &&
    recents.status === 'success' && allProducts.status === 'success' &&
    recentProducts.length === 0 && allMinusRecents.length === 0;

  const renderRow = (p: Product) => {
    const added = props.mode === 'add' && props.addedProductIds.has(p.id);
    return (
      <button key={p.id} onClick={() => onPick(p)} className={styles.row}>
        <div className={styles.rowInfo}>
          <div className={styles.rowName}>
            {added && <CheckIcon size={12} className={styles.addedCheck} />}
            <span className={styles.rowNameText}>{p.name}</span>
          </div>
          {p.brand && (
            <div className={`mono tiny ${styles.rowBrand}`}>{p.brand.toUpperCase()}</div>
          )}
        </div>
        <div className={styles.rowMacros}>
          <div className={styles.nutrition}>
            <span className={`mono ${styles.rowKcal}`}>{Math.round(p.per100.kcal)}</span>
            <MacroBreakdown macros={p.per100} />
          </div>
          <span className={`mono tiny ${styles.rowUnit}`}>per 100{p.unit}</span>
        </div>
      </button>
    );
  };

  const sectionHeader = (label: string) => (
    <div className={styles.sectionHeader}>
      <span className={`mono tiny caps ${styles.sectionLabel}`}>{label}</span>
    </div>
  );

  return (
    <>
      <div className={styles.header}>
        <span className={`mono caps ${styles.title}`}>{props.mode === 'replace' ? 'Change food' : 'Add Food'}</span>
        <button onClick={props.mode === 'replace' ? props.onBack : close} className={`mono tiny caps ${styles.cancelBtn}`}>
          {props.mode === 'replace' ? 'Back' : 'Cancel'}
        </button>
      </div>

      <div className={styles.searchBar}>
        <div className={styles.searchBox}>
          <MagnifyingGlassIcon size={14} className={styles.searchIcon} />
          <input
            placeholder="Search products..."
            maxLength={MAX_PRODUCT_SEARCH_QUERY_LENGTH}
            value={q}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className={styles.searchInput}
          />
          {q && (
            <button
              onClick={() => setQ('')}
              className={styles.clearBtn}
              aria-label="Clear"
            >
              <XMarkIcon size={14} />
            </button>
          )}
        </div>
        {props.mode === 'add' && <button onClick={props.onScanBarcode} className={styles.scanBtn} aria-label="Scan barcode">
          <BarcodeIcon size={20} />
        </button>}
      </div>

      {props.mode === 'add' && <div className={styles.scopeRow}>
        <button
          onClick={() => setGlobal(false)}
          className={`${styles.scopeBtn}${!global ? ` ${styles.scopeBtnActive}` : ''}`}
        >
          My Library
        </button>
        <button
          onClick={() => setGlobal(true)}
          className={`${styles.scopeBtn}${global ? ` ${styles.scopeBtnActive}` : ''}`}
        >
          Global
        </button>
      </div>}

      <div data-sheet-scroll className={`no-scroll ${styles.list}`}>
        {showingSearch ? (
          <>
            {search.status === 'error' && <div className={styles.errorMsg} role="alert">
              <span>Couldn't search foods.</span>
              <button className="btn-secondary" onClick={() => setSearchRetry((v) => v + 1)}>Retry</button>
            </div>}
            {search.status === 'loading' && search.products === null &&
              <div className={`mono tiny caps ${styles.loadingMsg}`}>Searching...</div>}
            {search.status === 'success' && search.products?.length === 0 &&
              <div className={styles.emptyMsg}>
                <div className={`mono ${styles.emptyQuery}`}>"{q}"</div>
                not in your library yet.
              </div>}
            {search.products !== null && search.products.length > 0 && <>
              {sectionHeader(
                `${search.products.length} result${search.products.length === 1 ? '' : 's'}`,
              )}
              {search.products.map(renderRow)}
            </>}
          </>
        ) : (
          <>
            {libraryError && <div className={styles.errorMsg} role="alert">
              <span>Couldn't load {recents.status === 'error' && allProducts.status === 'error'
                ? '' : recents.status === 'error' ? 'recent ' : 'all '}foods.</span>
              <button className="btn-secondary" onClick={() => setLibraryRetry((v) => v + 1)}>Retry</button>
            </div>}
            {(recents.status === 'loading' && recents.products === null ||
              allProducts.status === 'loading' && allProducts.products === null) &&
              <div className={`mono tiny caps ${styles.loadingMsg}`}>Loading...</div>}
            {idleEmpty && <div className={styles.emptyMsg}>
              {props.mode === 'replace' ? 'Your saved food library is empty.' : 'Your library is empty. Tap + Add New to create your first product.'}
            </div>}
            {recentProducts.length > 0 && (
              <>
                {sectionHeader('Recent')}
                {recentProducts.map(renderRow)}
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

      {props.mode === 'add' && <div className={styles.footer}>
        <button
          onClick={() => props.onAddTemp(q)}
          className={`btn-secondary ${styles.tempBtn}`}
        >
          <PlusIcon size={14} />
          Add Temp
        </button>
        <button
          onClick={() => props.onCreateNew(q)}
          className={`btn-primary ${styles.addNewBtn}`}
        >
          <PlusIcon size={14} />
          Add New
        </button>
      </div>}
    </>
  );
}
