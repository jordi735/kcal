// App shell — owns top-level state, routes between screens/modals.

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type {
  BarcodeLookupResponse,
  EntryGroup,
  EntryWithMacros,
  ExtractedLabel,
  Goals,
  Product,
} from './types';
import { getMonday, toLocalDateString, toLocalTimeString } from './dates';
import { Login } from './screens/Login';
import { OAuthConnect } from './screens/OAuthConnect';
import { Home } from './screens/Home';
import type { ProductDraft } from './modals/NewProductForm';
import { AppModals } from './components/AppModals';
import { SheetOverlay } from './components/SheetOverlay';
import { TransientErrorToast } from './components/TransientErrorToast';
import { useEntries } from './hooks/useEntries';
import { useTransientError } from './hooks/useTransientError';
import { useGoalRevalidation, useSessionGoals } from './hooks/useSessionGoals';
import { barcodeFillReturnState, isSheetModal, mergeLabelDraft, type ModalState } from './modalState';
import { userToGoals } from './session';
import { api, ApiError, clearStoredSession, oauthRequestId, requestLoginCode, verifyLoginCode } from './api';

export function App() {
  const request = oauthRequestId();
  return request === null ? <Tracker /> : <OAuthConnect request={request} />;
}

function Tracker() {
  const { user, setUser, goals, setGoals, applyGoals } = useSessionGoals();
  const {
    entriesByDate,
    weekTotals,
    loadedDates,
    load: loadEntries,
    loadWeek,
    add: addEntry,
    update: updateEntry,
    remove: removeEntry,
    createGroup,
    renameGroup,
    toggleGroupTagged,
    ungroup,
  } = useEntries();
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [modal, setModalState] = useState<ModalState>({ kind: 'none' });
  const [selectionResetVersion, setSelectionResetVersion] = useState(0);
  // Bumped on every modal transition. Async handlers capture this before
  // awaiting and bail if it changed during the await — prevents a slow
  // network response from yanking the user back into a modal they cancelled.
  const flowGenRef = useRef(0);
  const setModal = useCallback((next: ModalState) => {
    flowGenRef.current++;
    setModalState(next);
  }, []);
  const { transientError, errorExiting, reportError } = useTransientError();
  const activeSheetCloseRef = useRef<(() => void) | null>(null);
  const registerSheetClose = useCallback((fn: (() => void) | null) => {
    activeSheetCloseRef.current = fn;
  }, []);
  const [sheetExiting, setSheetExiting] = useState(false);
  const notifySheetExit = useCallback(() => setSheetExiting(true), []);

  const todayKey = toLocalDateString(new Date());
  const selectedKey = toLocalDateString(selectedDate);
  const entriesForSelected = entriesByDate[selectedKey] ?? [];
  const selectedLoaded = loadedDates.has(selectedKey);
  const todayEntries = entriesByDate[todayKey] ?? [];
  const addedProductIds = useMemo(
    () => new Set(todayEntries.map((e) => e.product.id)),
    [todayEntries],
  );

  // Reset the shared sheet-exit signal once the sheet is fully gone so the
  // next sheet opens with exiting=false. Deferred until modal.kind flips to
  // 'none' so SheetOverlay can observe exiting=true during its unmount render.
  useEffect(() => {
    if (modal.kind === 'none') setSheetExiting(false);
  }, [modal.kind]);

  // Load entries for the selected day and today whenever either changes. Key
  // user dependency on identity, not the cached object: goal revalidation
  // replaces that object and must not emit a duplicate round of entry reads.
  useEffect(() => {
    if (user === null) return;
    void loadEntries(selectedKey);
    if (selectedKey !== todayKey) void loadEntries(todayKey);
  }, [user?.id, selectedKey, todayKey, loadEntries]);

  // Load week totals for the visible week and both neighbors, so the
  // week-strip carousel can show real progress dots on swipe-in weeks. As with
  // day entries, goal-only user-object refreshes do not require another load.
  useEffect(() => {
    if (user === null) return;
    const prev = new Date(weekStart);
    prev.setDate(weekStart.getDate() - 7);
    const next = new Date(weekStart);
    next.setDate(weekStart.getDate() + 7);
    void loadWeek(toLocalDateString(weekStart));
    void loadWeek(toLocalDateString(prev));
    void loadWeek(toLocalDateString(next));
  }, [user?.id, weekStart, loadWeek]);

  useGoalRevalidation(user, setUser, setGoals);

  // Verify the 6-digit code and persist the session.
  const onVerifyCode = async (email: string, code: string): Promise<void> => {
    const user = await verifyLoginCode(email, code);
    setGoals(userToGoals(user));
    setUser(user);
  };

  if (user === null) {
    return <Login onRequestCode={requestLoginCode} onVerifyCode={onVerifyCode} />;
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

  const onMarkTagged = (list: EntryWithMacros[], tagged: boolean) => {
    for (const entry of list) {
      if (entry.tagged === tagged) continue;
      updateEntry(entry.id, { tagged }).catch((err) => {
        reportError(err instanceof Error ? err.message : "Couldn't update entry");
      });
    }
  };

  const onStartCreateGroup = (list: EntryWithMacros[]) => {
    setModal({ kind: 'entry-group-create', entryIds: list.map((entry) => entry.id) });
  };

  const onCreateEntryGroup = async (name: string): Promise<void> => {
    if (modal.kind !== 'entry-group-create') return;
    const entryIds = modal.entryIds;
    const myGen = flowGenRef.current;
    try {
      await createGroup({ name, entry_ids: entryIds });
      setSelectionResetVersion((version) => version + 1);
      if (myGen === flowGenRef.current) setModal({ kind: 'none' });
    } catch (err) {
      if (myGen !== flowGenRef.current) return;
      reportError(err instanceof Error ? err.message : "Couldn't create group");
    }
  };

  const onMarkGroupTagged = (groupId: number, tagged: boolean) => {
    toggleGroupTagged(groupId, tagged).catch((err) => {
      reportError(err instanceof Error ? err.message : "Couldn't update group");
    });
  };

  const onEditEntryGroup = (group: EntryGroup) => {
    setModal({ kind: 'entry-group-edit', group });
  };

  const onRenameEntryGroup = async (name: string): Promise<void> => {
    if (modal.kind !== 'entry-group-edit') return;
    const groupId = modal.group.id;
    const myGen = flowGenRef.current;
    try {
      await renameGroup(groupId, name);
      if (myGen === flowGenRef.current) setModal({ kind: 'none' });
    } catch (err) {
      if (myGen !== flowGenRef.current) return;
      reportError(err instanceof Error ? err.message : "Couldn't rename group");
    }
  };

  const onUngroupEntries = async (): Promise<void> => {
    if (modal.kind !== 'entry-group-edit') return;
    const groupId = modal.group.id;
    const myGen = flowGenRef.current;
    try {
      await ungroup(groupId);
      if (myGen === flowGenRef.current) setModal({ kind: 'none' });
    } catch (err) {
      if (myGen !== flowGenRef.current) return;
      reportError(err instanceof Error ? err.message : "Couldn't ungroup entries");
    }
  };

  // AddPicker handlers
  const onPick = async (product: Product) => {
    const myGen = flowGenRef.current;
    try {
      // Cross-user search results carry is_mine === false. Adopt creates a
      // user-owned copy (idempotent on barcode) so subsequent flows treat it
      // as a normal owned product.
      const owned =
        product.is_mine === false
          ? await api<Product>(`/products/adopt/${product.id}`, { method: 'POST' })
          : product;
      if (myGen !== flowGenRef.current) return;
      setModal({ kind: 'grams-picker', product: owned, entry: undefined });
    } catch (err) {
      if (myGen !== flowGenRef.current) return;
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
    const myGen = flowGenRef.current;
    try {
      const result = await api<BarcodeLookupResponse>(
        `/products/barcode/${encodeURIComponent(code)}`,
      );
      if (myGen !== flowGenRef.current) return;
      if (result.kind === 'own') {
        setModal({ kind: 'grams-picker', product: result.product, entry: undefined });
      } else {
        // 'template' — another user has this barcode. Open the new-product
        // form prefilled; saving creates the scanning user's own copy.
        setModal({ kind: 'new-product', initial: result.template });
      }
    } catch (err) {
      if (myGen !== flowGenRef.current) return;
      if (err instanceof ApiError && err.status === 404) {
        setModal({ kind: 'new-product', initial: { barcode: code } });
      }
      // Other errors: leave the scanner closed; api.ts already handles 401.
    }
  };

  // NewProductForm handlers. draftSoFar is a live snapshot of the form's local
  // state, pushed up by the form on click — reading modal.initial here would be
  // stale (that's only the seed values at mount time).
  const onScanLabel = (draftSoFar: Partial<ProductDraft>) => {
    setModal({ kind: 'ai-label-scanner', draftSoFar });
  };

  // Scan-from-form: open the scanner, preserve enough context to return to
  // the same form with the scanned code merged into the barcode field.
  const onScanBarcodeFromForm = (draftSoFar: Partial<ProductDraft>) => {
    if (modal.kind === 'new-product') {
      setModal({
        kind: 'barcode-scanner-fill',
        returnTo: 'new',
        draftSoFar,
      });
    } else if (modal.kind === 'edit-product') {
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
    setModal({ kind: 'new-product', initial: mergeLabelDraft(draftSoFar, label) });
  };

  const onLabelScannerClose = () => {
    if (modal.kind !== 'ai-label-scanner') return;
    setModal({ kind: 'new-product', initial: modal.draftSoFar });
  };

  const onBarcodeFillDetect = (code: string) => {
    if (modal.kind !== 'barcode-scanner-fill') return;
    setModal(barcodeFillReturnState(modal, code));
  };

  const onBarcodeFillClose = () => {
    if (modal.kind !== 'barcode-scanner-fill') return;
    setModal(barcodeFillReturnState(modal));
  };

  const onProductSave = async (draft: ProductDraft): Promise<void> => {
    const myGen = flowGenRef.current;
    try {
      const saved = await api<Product>('/products', { method: 'POST', body: draft });
      if (myGen !== flowGenRef.current) return;
      setModal({ kind: 'grams-picker', product: saved, entry: undefined });
    } catch (err) {
      if (myGen !== flowGenRef.current) return;
      reportError(err instanceof Error ? err.message : "Couldn't save product");
      // Leave the modal open so the user can retry; 401 is handled by api.ts.
    }
  };

  const onEditProduct = () => {
    if (modal.kind !== 'grams-picker') return;
    setModal({ kind: 'edit-product', product: modal.product, entry: modal.entry });
  };

  const onEditProductClose = () => {
    if (modal.kind !== 'edit-product') return;
    setModal({ kind: 'grams-picker', product: modal.product, entry: modal.entry });
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
      updateEntry(entry.id, { grams }).catch((err) => {
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
    applyGoals(saved);
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
      <TransientErrorToast message={transientError} exiting={errorExiting} />

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
        onMarkTagged={onMarkTagged}
        onCreateGroup={onStartCreateGroup}
        onMarkGroupTagged={onMarkGroupTagged}
        onEditGroup={onEditEntryGroup}
        selectionResetVersion={selectionResetVersion}
        onOpenSettings={() => setModal({ kind: 'settings' })}
        onOpenWeights={() => setModal({ kind: 'weights' })}
      />

      <SheetOverlay
        visible={isSheetModal(modal.kind)}
        exiting={sheetExiting}
        onClick={() => activeSheetCloseRef.current?.()}
      />

      <AppModals
        modal={modal}
        goals={goals}
        entriesForSelected={entriesForSelected}
        addedProductIds={addedProductIds}
        userEmail={user.email}
        registerSheetClose={registerSheetClose}
        notifySheetExit={notifySheetExit}
        handlers={{
          closeModal,
          onAddEntry,
          onPick,
          onCreateNew,
          onAddTemp,
          onScanBarcode,
          onProductSave,
          onScanLabel,
          onScanBarcodeFromForm,
          onGramsDelete,
          onGramsConfirm,
          onEditProduct,
          onProductEditSave,
          onProductDelete,
          onEditProductClose,
          onSaveGoals,
          onLogout,
          onCreateEntryGroup,
          onRenameEntryGroup,
          onUngroupEntries,
          onBarcodeDetect,
          onBarcodeFillDetect,
          onBarcodeFillClose,
          onLabelExtracted,
          onLabelScannerClose,
        }}
      />
    </>
  );
}
