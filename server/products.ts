// Shared saved-food discovery and adoption. Callers authenticate users; every
// owned-library statement binds the authenticated user at the SQL boundary.
import { productSearchTerms } from '../shared/normalize.js';
import { WriteError } from './errors.js';
import { statements } from './statements.js';
import type { Product, ProductAdoptionResult, ProductRow, ProductSearchRow, ProductTemplate } from './types.js';

export function rowToProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    unit: row.unit === 'ml' ? 'ml' : 'g',
    barcode: row.barcode,
    per100: {
      kcal: row.kcal_per100,
      protein: row.protein_per100,
      carbs: row.carbs_per100,
      fat: row.fat_per100,
    },
    is_temp: row.is_temp === 1,
  };
}

function searchRowToProduct(row: ProductSearchRow): Product {
  return { ...rowToProduct(row), is_mine: row.is_mine === 1 };
}

export function searchOwnProducts(userId: number, query: string): Product[] {
  const q = query.trim();
  if (q === '') return [];
  return searchProductPage(userId, { query: q, sort: 'name', limit: 50, offset: 0 }).products;
}

export function searchGlobalProducts(userId: number, query: string): Product[] {
  const rows = statements.products.search.all(
    JSON.stringify(productSearchTerms(query)),
    userId,
    userId,
    userId,
  );
  return rows.map(searchRowToProduct);
}

export function listOwnProducts(userId: number): Product[] {
  return statements.products.all.all(userId).map(rowToProduct);
}

export function searchProductPage(userId: number, options: {
  query?: string;
  sort: 'name' | 'recent';
  limit: number;
  offset: number;
}): { products: Product[]; next_offset: number | null } {
  const terms = JSON.stringify(productSearchTerms(options.query ?? ''));
  const { limit, offset } = options;
  const rows = options.sort === 'recent'
    ? statements.products.pageByRecent.all(userId, userId, terms, limit + 1, offset)
    : statements.products.pageByName.all(userId, terms, limit + 1, offset);
  return {
    products: rows.slice(0, limit).map(rowToProduct),
    next_offset: rows.length > limit ? offset + limit : null,
  };
}

export function lookupBarcode(userId: number, barcode: string): {
  products: Product[];
  template: ProductTemplate | null;
} {
  const code = barcode.trim();
  const own = statements.products.byBarcode.get(userId, code);
  if (own !== undefined) return { products: [rowToProduct(own)], template: null };
  const shared = statements.products.byBarcodeAnyUser.get(code);
  if (shared === undefined) return { products: [], template: null };
  // Construct this projection explicitly. Source IDs, ownership and temporary
  // status must never leak into a shared barcode prefill, including MCP text.
  return {
    products: [],
    template: {
      name: shared.name,
      brand: shared.brand,
      unit: shared.unit === 'ml' ? 'ml' : 'g',
      barcode: shared.barcode,
      per100: {
        kcal: shared.kcal_per100,
        protein: shared.protein_per100,
        carbs: shared.carbs_per100,
        fat: shared.fat_per100,
      },
    },
  };
}

export function adoptProduct(userId: number, sourceId: number): ProductAdoptionResult {
  const source = statements.products.byIdAnyUser.get(sourceId);
  if (source === undefined) throw new WriteError(404, 'not_found');
  // Privacy guard: arbitrary IDs must never expose private or temporary products.
  if (source.barcode === null || source.is_temp !== 0) {
    throw new WriteError(400, 'not_adoptable');
  }
  if (source.created_by === userId) {
    return { product: rowToProduct(source), created: false };
  }
  // Preserve the existing sequential reuse check; this is not a concurrent
  // uniqueness guarantee. Adoption copies stored values without normalization.
  const existing = statements.products.byBarcode.get(userId, source.barcode);
  if (existing !== undefined) {
    return { product: rowToProduct(existing), created: false };
  }
  const result = statements.products.insert.run(
    source.name,
    source.brand,
    source.unit,
    source.barcode,
    source.kcal_per100,
    source.protein_per100,
    source.carbs_per100,
    source.fat_per100,
    0,
    userId,
    Date.now(),
  );
  const row = statements.products.selectById.get(userId, Number(result.lastInsertRowid));
  if (row === undefined) throw new WriteError(500, 'insert_failed');
  return { product: rowToProduct(row), created: true };
}
