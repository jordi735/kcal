import { sumMacros, type EntryWithMacros, type ExtractedLabel, type Goals, type Product } from '../types';
import { productToDraft, type ModalState } from '../modalState';
import { Settings } from '../screens/Settings';
import { AddPicker } from '../modals/AddPicker';
import { BarcodeScanner } from '../modals/BarcodeScanner';
import { AILabelScanner } from '../modals/AILabelScanner';
import { NewProductForm, type ProductDraft } from '../modals/NewProductForm';
import { GramsPicker } from '../modals/GramsPicker';
import { EntryGroupForm } from '../modals/EntryGroupForm';
import { WeightTracker } from '../modals/WeightTracker';
import { SheetCloseRegisterProvider } from './Sheet';

type AppModalHandlers = {
  closeModal: () => void;
  onAddEntry: () => void;
  onPick: (product: Product) => Promise<void>;
  onCreateNew: (name: string) => void;
  onAddTemp: (name: string) => void;
  onScanBarcode: () => void;
  onProductSave: (draft: ProductDraft) => Promise<void>;
  onScanLabel: (draft: Partial<ProductDraft>) => void;
  onScanBarcodeFromForm: (draft: Partial<ProductDraft>) => void;
  onGramsDelete: () => void;
  onGramsConfirm: (grams: number) => void;
  onEditProduct: () => void;
  onProductEditSave: (draft: ProductDraft) => Promise<void>;
  onProductDelete: () => Promise<void>;
  onEditProductClose: () => void;
  onSaveGoals: (goals: Goals) => Promise<void>;
  onLogout: () => Promise<void>;
  onCreateEntryGroup: (name: string) => Promise<void>;
  onRenameEntryGroup: (name: string) => Promise<void>;
  onUngroupEntries: () => Promise<void>;
  onBarcodeDetect: (code: string) => Promise<void>;
  onBarcodeFillDetect: (code: string) => void;
  onBarcodeFillClose: () => void;
  onLabelExtracted: (label: ExtractedLabel) => void;
  onLabelScannerClose: () => void;
};

type AppModalsProps = {
  modal: ModalState;
  goals: Goals;
  entriesForSelected: EntryWithMacros[];
  addedProductIds: ReadonlySet<number>;
  userEmail: string;
  registerSheetClose: (close: (() => void) | null) => void;
  notifySheetExit: () => void;
  handlers: AppModalHandlers;
};

// Keep each modal kind in its own sibling slot, including variants sharing a
// component type. Moving between variants must mount a fresh local form state.
export function AppModals({
  modal,
  goals,
  entriesForSelected,
  addedProductIds,
  userEmail,
  registerSheetClose,
  notifySheetExit,
  handlers,
}: AppModalsProps) {
  return (
    <>
      <SheetCloseRegisterProvider register={registerSheetClose} notifyExit={notifySheetExit}>
        {modal.kind === 'add-picker' && (
          <AddPicker
            onPick={handlers.onPick}
            onCreateNew={handlers.onCreateNew}
            onAddTemp={handlers.onAddTemp}
            onScanBarcode={handlers.onScanBarcode}
            onClose={handlers.closeModal}
            addedProductIds={addedProductIds}
          />
        )}

        {modal.kind === 'new-product' && (
          <NewProductForm
            {...(modal.initial !== undefined ? { initial: modal.initial } : {})}
            onSave={handlers.onProductSave}
            onClose={handlers.onAddEntry}
            onDismiss={handlers.closeModal}
            onScanLabel={handlers.onScanLabel}
            onScanBarcode={handlers.onScanBarcodeFromForm}
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
                  onDelete: handlers.onGramsDelete,
                }
              : { mode: 'add' as const })}
            onConfirm={handlers.onGramsConfirm}
            onClose={handlers.closeModal}
            onEditProduct={handlers.onEditProduct}
          />
        )}

        {modal.kind === 'edit-product' && (
          <NewProductForm
            initial={modal.initialOverride ?? productToDraft(modal.product)}
            mode="edit"
            onSave={handlers.onProductEditSave}
            onDelete={handlers.onProductDelete}
            onClose={handlers.onEditProductClose}
            onDismiss={handlers.closeModal}
            onScanLabel={handlers.onScanLabel}
            onScanBarcode={handlers.onScanBarcodeFromForm}
          />
        )}

        {modal.kind === 'settings' && (
          <Settings
            goals={goals}
            onSave={handlers.onSaveGoals}
            onClose={handlers.closeModal}
            onLogout={handlers.onLogout}
            userEmail={userEmail}
          />
        )}

        {modal.kind === 'weights' && (
          <WeightTracker onClose={handlers.closeModal} />
        )}

        {modal.kind === 'entry-group-create' && (
          <EntryGroupForm
            mode="create"
            onSave={handlers.onCreateEntryGroup}
            onClose={handlers.closeModal}
          />
        )}

        {modal.kind === 'entry-group-edit' && (
          <EntryGroupForm
            mode="edit"
            initialName={modal.group.name}
            onSave={handlers.onRenameEntryGroup}
            onUngroup={handlers.onUngroupEntries}
            onClose={handlers.closeModal}
          />
        )}
      </SheetCloseRegisterProvider>

      {modal.kind === 'barcode-scanner' && (
        <BarcodeScanner
          onDetect={handlers.onBarcodeDetect}
          onClose={handlers.onAddEntry}
        />
      )}

      {modal.kind === 'barcode-scanner-fill' && (
        <BarcodeScanner
          onDetect={handlers.onBarcodeFillDetect}
          onClose={handlers.onBarcodeFillClose}
        />
      )}

      {modal.kind === 'ai-label-scanner' && (
        <AILabelScanner
          onExtracted={handlers.onLabelExtracted}
          onClose={handlers.onLabelScannerClose}
        />
      )}
    </>
  );
}
