import type { ProductDraft } from './modals/NewProductForm';
import type { EntryGroup, EntryWithMacros, Product } from './types';

export type ModalState =
  | { kind: 'none' }
  | { kind: 'add-picker' }
  | { kind: 'barcode-scanner' }
  | {
      kind: 'barcode-scanner-fill';
      returnTo: 'new';
      draftSoFar: Partial<ProductDraft>;
    }
  | {
      kind: 'barcode-scanner-fill';
      returnTo: 'edit';
      draftSoFar: Partial<ProductDraft>;
      editProduct: Product;
      editEntry: EntryWithMacros | undefined;
    }
  | { kind: 'new-product'; initial: Partial<ProductDraft> | undefined }
  | { kind: 'grams-picker'; product: Product; entry: EntryWithMacros | undefined }
  | {
      kind: 'edit-product';
      product: Product;
      entry: EntryWithMacros | undefined;
      initialOverride?: Partial<ProductDraft>;
    }
  | { kind: 'settings'; initialGuide?: boolean }
  | { kind: 'weights' }
  | { kind: 'entry-group-create'; entryIds: number[] }
  | { kind: 'entry-group-edit'; group: EntryGroup };

// Modals that render inside <Sheet> and share the hoisted SheetOverlay.
const SHEET_KINDS: ReadonlySet<ModalState['kind']> = new Set([
  'add-picker',
  'new-product',
  'grams-picker',
  'edit-product',
  'settings',
  'weights',
  'entry-group-create',
  'entry-group-edit',
]);

export function isSheetModal(kind: ModalState['kind']): boolean {
  return SHEET_KINDS.has(kind);
}

export function productToDraft(product: Product): Partial<ProductDraft> {
  return {
    name: product.name,
    brand: product.brand,
    unit: product.unit,
    barcode: product.barcode,
    per100: product.per100,
  };
}

export function barcodeFillReturnState(
  modal: Extract<ModalState, { kind: 'barcode-scanner-fill' }>,
  barcode?: string,
): Extract<ModalState, { kind: 'new-product' | 'edit-product' }> {
  const draft = barcode === undefined ? modal.draftSoFar : { ...modal.draftSoFar, barcode };
  if (modal.returnTo === 'new') {
    return { kind: 'new-product', initial: draft };
  }
  return {
    kind: 'edit-product',
    product: modal.editProduct,
    entry: modal.editEntry,
    initialOverride: draft,
  };
}
