// Shared saved-food discovery. Authentication stays with each caller; every
// owned-library statement binds the authenticated user at the SQL boundary.
import { productSearchTerms } from '../shared/normalize.js';
import { statements } from './statements.js';
import type { Product, ProductRow, ProductTemplate } from './types.js';

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

export function searchProductPage(userId: number, options: {
  query?: string;
  sort: 'name' | 'recent';
  limit: number;
  offset: number;
}): { products: Product[]; next_offset: number | null } {
  const terms = JSON.stringify(productSearchTerms(options.query ?? ''));
  const { limit, offset } = options;
  const rows = (options.sort === 'recent'
    ? statements.products.pageByRecent.all(userId, userId, terms, limit + 1, offset)
    : statements.products.pageByName.all(userId, terms, limit + 1, offset)) as ProductRow[];
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
  const own = statements.products.byBarcode.get(userId, code) as ProductRow | undefined;
  if (own !== undefined) return { products: [rowToProduct(own)], template: null };
  const shared = statements.products.byBarcodeAnyUser.get(code) as ProductRow | undefined;
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
