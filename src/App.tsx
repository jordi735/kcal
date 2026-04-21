// App shell — owns top-level state, routes between screens/modals.

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  sumMacros,
  type BarcodeLookupResponse,
  type EntryWithMacros,
  type ExtractedLabel,
  type Goals,
  type Product,
  type User,
} from './types';
import { getMonday, toLocalDateString, toLocalTimeString } from './dates';
import { mockGoals } from './mocks';
import { Login } from './screens/Login';
import { Settings } from './screens/Settings';
import { Home } from './screens/Home';
import { AddPicker } from './modals/AddPicker';
import { BarcodeScanner } from './modals/BarcodeScanner';
import { AILabelScanner } from './modals/AILabelScanner';
import { NewProductForm, type ProductDraft } from './modals/NewProductForm';
import { GramsPicker } from './modals/GramsPicker';
import { SheetCloseRegisterProvider } from './components/Sheet';
import { useEntries } from './hooks/useEntries';
import { FADE_EXIT_MS } from './hooks/useFadeClose';
import { api, ApiError, clearStoredSession, SESSION_TOKEN_KEY, USER_KEY } from './api';
import styles from './App.module.css';

// Shared backdrop for sheet-style modals — stays mounted across sheet-to-sheet
// transitions so the dim layer never flashes between them.
function SheetOverlay({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  const [render, setRender] = useState(visible);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (visible) {
      setRender(true);
      setExiting(false);
      return;
    }
    if (!render) return;
    setExiting(true);
    const t = window.setTimeout(() => {
      setRender(false);
      setExiting(false);
    }, FADE_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [visible, render]);

  if (!render) return null;
  return <div className={`overlay${exiting ? ' exiting' : ''}`} onClick={onClick} />;
}

function readStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

function readStoredToken(): string | null {
  const raw = localStorage.getItem(SESSION_TOKEN_KEY);
  if (raw === null || raw === '') return null;
  return raw;
}

type ModalState =
  | { kind: 'none' }
  | { kind: 'add-picker' }
  | { kind: 'barcode-scanner' }
  | {
      kind: 'barcode-scanner-fill';
      returnTo: 'new' | 'edit';
      draftSoFar: Partial<ProductDraft>;
      editProduct?: Product;
      editEntry?: EntryWithMacros | undefined;
    }
  | { kind: 'ai-label-scanner'; draftSoFar: Partial<ProductDraft> }
  | { kind: 'new-product'; initial: Partial<ProductDraft> | undefined }
  | { kind: 'grams-picker'; product: Product; entry: EntryWithMacros | undefined }
  | {
      kind: 'edit-product';
      product: Product;
      entry: EntryWithMacros | undefined;
      initialOverride?: Partial<ProductDraft>;
    }
  | { kind: 'settings' };

// Modals that render inside <Sheet> and share the hoisted SheetOverlay.
function isSheetModal(kind: ModalState['kind']): boolean {
  return (
    kind === 'add-picker' ||
    kind === 'new-product' ||
    kind === 'grams-picker' ||
    kind === 'edit-product' ||
    kind === 'settings'
  );
}

function productToDraft(p: Product): Partial<ProductDraft> {
  return {
    name: p.name,
    brand: p.brand,
    unit: p.unit,
    barcode: p.barcode,
    per100: p.per100,
  };
}

function userToGoals(u: User): Goals {
  return {
    kcal: u.goal_kcal,
    protein: u.goal_protein,
    carbs: u.goal_carbs,
    fat: u.goal_fat,
  };
}

export function App() {
  const initialToken = readStoredToken();
  const initialUser = readStoredUser();
  const bootedLoggedIn = initialToken !== null && initialUser !== null;

  const [user, setUser] = useState<User | null>(bootedLoggedIn ? initialUser : null);
  const {
    entriesByDate,
    weekTotals,
    loadedDates,
    load: loadEntries,
    loadWeek,
    add: addEntry,
    update: updateEntry,
    remove: removeEntry,
  } = useEntries();
  const [goals, setGoals] = useState<Goals>(() =>
    initialUser !== null ? userToGoals(initialUser) : mockGoals,
  );
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [transientError, setTransientError] = useState<string | null>(null);
  const [errorExiting, setErrorExiting] = useState(false);
  const activeSheetCloseRef = useRef<(() => void) | null>(null);
  const registerSheetClose = useCallback((fn: (() => void) | null) => {
    activeSheetCloseRef.current = fn;
  }, []);

  const reportError = useCallback((msg: string) => {
    setTransientError(msg);
    setErrorExiting(false);
    window.setTimeout(() => {
      setErrorExiting(true);
      window.setTimeout(() => {
        setTransientError((cur) => (cur === msg ? null : cur));
        setErrorExiting(false);
      }, FADE_EXIT_MS);
    }, 3750);
  }, []);

  const todayKey = toLocalDateString(new Date());
  const selectedKey = toLocalDateString(selectedDate);
  const entriesForSelected = entriesByDate[selectedKey] ?? [];
  const selectedLoaded = loadedDates.has(selectedKey);
  const todayEntries = entriesByDate[todayKey] ?? [];
  const addedProductIds = useMemo(
    () => new Set(todayEntries.map((e) => e.product.id)),
    [todayEntries],
  );

  // Load entries for the selected day and today whenever either changes.
  useEffect(() => {
    if (user === null) return;
    void loadEntries(selectedKey);
    if (selectedKey !== todayKey) void loadEntries(todayKey);
  }, [user, selectedKey, todayKey, loadEntries]);

  // Load week totals for the visible week and both neighbors, so the
  // week-strip carousel can show real progress dots on swipe-in weeks.
  useEffect(() => {
    if (user === null) return;
    const prev = new Date(weekStart);
    prev.setDate(weekStart.getDate() - 7);
    const next = new Date(weekStart);
    next.setDate(weekStart.getDate() + 7);
    void loadWeek(toLocalDateString(weekStart));
    void loadWeek(toLocalDateString(prev));
    void loadWeek(toLocalDateString(next));
  }, [user, weekStart, loadWeek]);

  // Handle login — request a 6-digit sign-in code by email.
  const onRequestCode = async (email: string): Promise<void> => {
    await api<{ ok: true }>('/auth/request-code', {
      method: 'POST',
      body: { email },
    });
  };

  // Verify the 6-digit code and persist the session.
  const onVerifyCode = async (email: string, code: string): Promise<void> => {
    const res = await api<{ session_token: string; user: User }>('/auth/verify-code', {
      method: 'POST',
      body: { email, code },
    });
    localStorage.setItem(SESSION_TOKEN_KEY, res.session_token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setGoals(userToGoals(res.user));
    setUser(res.user);
  };

  if (user === null) {
    return <Login onRequestCode={onRequestCode} onVerifyCode={onVerifyCode} />;
  }

  const closeModal = () => setModal({ kind: 'none' });

  // Home handlers
  const onAddEntry = () => setModal({ kind: 'add-picker' });

  const onEditEntry = (entry: EntryWithMacros) => {
    setModal({ kind: 'grams-picker', product: entry.product, entry });
  };

  const onDeleteEntries = (list: EntryWithMacros[]) => {
    for (const entry of list) {
      removeEntry(entry.id, entry.local_date).catch((err) => {
        reportError(err instanceof Error ? err.message : "Couldn't remove entry");
      });
    }
  };

  // AddPicker handlers
  const onPick = async (product: Product) => {
    try {
      // Cross-user search results carry is_mine === false. Adopt creates a
      // user-owned copy (idempotent on barcode) so subsequent flows treat it
      // as a normal owned product.
      const owned =
        product.is_mine === false
          ? await api<Product>(`/products/adopt/${product.id}`, { method: 'POST' })
          : product;
      setModal({ kind: 'grams-picker', product: owned, entry: undefined });
    } catch (err) {
      reportError(err instanceof Error ? err.message : "Couldn't add product");
    }
  };
  const onCreateNew = (name: string) => {
    const trimmed = name.trim();
    setModal({
      kind: 'new-product',
      initial: trimmed === '' ? undefined : { name: trimmed },
    });
  };
  const onAddTemp = (name: string) => {
    const trimmed = name.trim();
    setModal({
      kind: 'new-product',
      initial: trimmed === '' ? { is_temp: true } : { name: trimmed, is_temp: true },
    });
  };
  const onScanBarcode = () => {
    setModal({ kind: 'barcode-scanner' });
  };

  // BarcodeScanner handler
  const onBarcodeDetect = async (code: string) => {
    try {
      const result = await api<BarcodeLookupResponse>(
        `/products/barcode/${encodeURIComponent(code)}`,
      );
      if (result.kind === 'own') {
        setModal({ kind: 'grams-picker', product: result.product, entry: undefined });
      } else {
        // 'template' — another user has this barcode. Open the new-product
        // form prefilled; saving creates the scanning user's own copy.
        setModal({ kind: 'new-product', initial: result.template });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setModal({ kind: 'new-product', initial: { barcode: code } });
      }
      // Other errors: leave the scanner closed; api.ts already handles 401.
    }
  };

  // NewProductForm handlers
  const onScanLabel = () => {
    const draftSoFar: Partial<ProductDraft> =
      modal.kind === 'new-product' && modal.initial !== undefined
        ? modal.initial
        : {};
    setModal({ kind: 'ai-label-scanner', draftSoFar });
  };

  // Scan-from-form: open the scanner, preserve enough context to return to
  // the same form with the scanned code merged into the barcode field.
  const onScanBarcodeFromForm = () => {
    if (modal.kind === 'new-product') {
      setModal({
        kind: 'barcode-scanner-fill',
        returnTo: 'new',
        draftSoFar: modal.initial ?? {},
      });
    } else if (modal.kind === 'edit-product') {
      const draftSoFar = modal.initialOverride ?? productToDraft(modal.product);
      setModal({
        kind: 'barcode-scanner-fill',
        returnTo: 'edit',
        draftSoFar,
        editProduct: modal.product,
        editEntry: modal.entry,
      });
    }
  };

  const onLabelExtracted = (label: ExtractedLabel) => {
    const draftSoFar: Partial<ProductDraft> =
      modal.kind === 'ai-label-scanner' ? modal.draftSoFar : {};
    setModal({
      kind: 'new-product',
      initial: { ...draftSoFar, ...label },
    });
  };

  const onProductSave = async (draft: ProductDraft): Promise<void> => {
    try {
      const saved = await api<Product>('/products', { method: 'POST', body: draft });
      setModal({ kind: 'grams-picker', product: saved, entry: undefined });
    } catch (err) {
      reportError(err instanceof Error ? err.message : "Couldn't save product");
      // Leave the modal open so the user can retry; 401 is handled by api.ts.
    }
  };

  const onEditProduct = () => {
    if (modal.kind !== 'grams-picker') return;
    setModal({ kind: 'edit-product', product: modal.product, entry: modal.entry });
  };

  const onProductEditSave = async (draft: ProductDraft): Promise<void> => {
    if (modal.kind !== 'edit-product') return;
    const productId = modal.product.id;
    const { is_temp: _unused, ...putBody } = draft;
    try {
      await api<Product>(`/products/${productId}`, { method: 'PUT', body: putBody });
      await loadEntries(selectedKey);
      await loadWeek(toLocalDateString(weekStart));
      setModal({ kind: 'none' });
    } catch (err) {
      reportError(err instanceof Error ? err.message : "Couldn't save product");
      // Leave modal open so user can retry.
    }
  };

  // Destructive: server cascades to every entry this user logged against the
  // product (macros are computed at read time, so we can't just null them out).
  // Reload selected day + today + week to clear any cached rows that had it.
  const onProductDelete = async (): Promise<void> => {
    if (modal.kind !== 'edit-product') return;
    const productId = modal.product.id;
    try {
      await api<{ ok: true }>(`/products/${productId}`, { method: 'DELETE' });
      setModal({ kind: 'none' });
      await loadEntries(selectedKey);
      if (selectedKey !== todayKey) await loadEntries(todayKey);
      await loadWeek(toLocalDateString(weekStart));
    } catch (err) {
      reportError(err instanceof Error ? err.message : "Couldn't delete product");
      // Leave modal open so user can retry.
    }
  };

  // GramsPicker handlers
  const onGramsConfirm = (grams: number) => {
    if (modal.kind !== 'grams-picker') return;
    const { product, entry } = modal;

    if (entry !== undefined) {
      updateEntry(entry.id, grams).catch((err) => {
        reportError(err instanceof Error ? err.message : "Couldn't update entry");
      });
    } else {
      const now = new Date();
      addEntry({
        product_id: product.id,
        grams,
        local_date: selectedKey,
        local_time: toLocalTimeString(now),
      }).catch((err) => {
        reportError(err instanceof Error ? err.message : "Couldn't add entry");
      });
    }
    closeModal();
  };

  const onGramsDelete = () => {
    if (modal.kind !== 'grams-picker' || modal.entry === undefined) return;
    const toDelete = modal.entry;
    removeEntry(toDelete.id, toDelete.local_date).catch((err) => {
      reportError(err instanceof Error ? err.message : "Couldn't remove entry");
    });
    closeModal();
  };

  // Settings handlers
  const onSaveGoals = async (next: Goals): Promise<void> => {
    const saved = await api<Goals>('/settings', { method: 'PUT', body: next });
    setGoals(saved);
    if (user !== null) {
      const updatedUser: User = {
        ...user,
        goal_kcal: saved.kcal,
        goal_protein: saved.protein,
        goal_carbs: saved.carbs,
        goal_fat: saved.fat,
      };
      localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
      setUser(updatedUser);
    }
  };
  const onLogout = async () => {
    try {
      await api<{ ok: true }>('/auth/logout', { method: 'POST' });
    } catch {
      // Even if logout fails server-side, clear local state.
    }
    clearStoredSession();
    setModal({ kind: 'none' });
    setUser(null);
  };

  return (
    <>
      {transientError !== null && (
        <div className={`${styles.toast} mono tiny caps${errorExiting ? ' fullscreen-exit' : ''}`}>
          {transientError}
        </div>
      )}

      <Home
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        weekStart={weekStart}
        onChangeWeek={setWeekStart}
        entries={entriesForSelected}
        loaded={selectedLoaded}
        totalsByDate={weekTotals}
        goals={goals}
        onAddEntry={onAddEntry}
        onEditEntry={onEditEntry}
        onDeleteEntries={onDeleteEntries}
        onOpenSettings={() => setModal({ kind: 'settings' })}
      />

      <SheetOverlay
        visible={isSheetModal(modal.kind)}
        onClick={() => activeSheetCloseRef.current?.()}
      />

      <SheetCloseRegisterProvider register={registerSheetClose}>
        {modal.kind === 'add-picker' && (
          <AddPicker
            onPick={onPick}
            onCreateNew={onCreateNew}
            onAddTemp={onAddTemp}
            onScanBarcode={onScanBarcode}
            onClose={closeModal}
            addedProductIds={addedProductIds}
          />
        )}

        {modal.kind === 'new-product' && (
          <NewProductForm
            {...(modal.initial !== undefined ? { initial: modal.initial } : {})}
            onSave={onProductSave}
            onClose={() => setModal({ kind: 'add-picker' })}
            onScanLabel={onScanLabel}
            onScanBarcode={onScanBarcodeFromForm}
          />
        )}

        {modal.kind === 'grams-picker' && (
          <GramsPicker
            product={modal.product}
            goals={goals}
            existingTotals={sumMacros(
              modal.entry !== undefined
                ? entriesForSelected.filter((e) => e.id !== modal.entry!.id)
                : entriesForSelected,
            )}
            {...(modal.entry !== undefined
              ? {
                  initialGrams: modal.entry.grams,
                  mode: 'edit' as const,
                  onDelete: onGramsDelete,
                }
              : { mode: 'add' as const })}
            onConfirm={onGramsConfirm}
            onClose={closeModal}
            onEditProduct={onEditProduct}
          />
        )}

        {modal.kind === 'edit-product' && (
          <NewProductForm
            initial={modal.initialOverride ?? productToDraft(modal.product)}
            mode="edit"
            onSave={onProductEditSave}
            onDelete={onProductDelete}
            onClose={() =>
              setModal({
                kind: 'grams-picker',
                product: modal.product,
                entry: modal.entry,
              })
            }
            onScanLabel={onScanLabel}
            onScanBarcode={onScanBarcodeFromForm}
          />
        )}

        {modal.kind === 'settings' && (
          <Settings
            goals={goals}
            onSave={onSaveGoals}
            onClose={closeModal}
            onLogout={onLogout}
            userEmail={user.email}
          />
        )}
      </SheetCloseRegisterProvider>

      {modal.kind === 'barcode-scanner' && (
        <BarcodeScanner
          onDetect={onBarcodeDetect}
          onClose={() => setModal({ kind: 'add-picker' })}
        />
      )}

      {modal.kind === 'barcode-scanner-fill' && (
        <BarcodeScanner
          onDetect={(code) => {
            const merged = { ...modal.draftSoFar, barcode: code };
            if (modal.returnTo === 'new') {
              setModal({ kind: 'new-product', initial: merged });
            } else if (modal.editProduct !== undefined) {
              setModal({
                kind: 'edit-product',
                product: modal.editProduct,
                entry: modal.editEntry,
                initialOverride: merged,
              });
            }
          }}
          onClose={() => {
            if (modal.returnTo === 'new') {
              setModal({ kind: 'new-product', initial: modal.draftSoFar });
            } else if (modal.editProduct !== undefined) {
              setModal({
                kind: 'edit-product',
                product: modal.editProduct,
                entry: modal.editEntry,
                initialOverride: modal.draftSoFar,
              });
            }
          }}
        />
      )}

      {modal.kind === 'ai-label-scanner' && (
        <AILabelScanner
          onExtracted={onLabelExtracted}
          onClose={() =>
            setModal({
              kind: 'new-product',
              initial: modal.draftSoFar,
            })
          }
        />
      )}
    </>
  );
}
