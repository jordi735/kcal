// Stored product text policy. REST/MCP keep their own input-shape parsing;
// these helpers validate raw limits and return the exact normalized values.
import {
  MAX_PRODUCT_BARCODE_LENGTH, MAX_PRODUCT_BRAND_LENGTH, MAX_PRODUCT_NAME_LENGTH,
} from './constraints.js';
import { normalizeBrandName, normalizeProductName } from './normalize.js';
import type { Product } from './types.js';

type ParsedText<T> = { value: T } | null;
type ProductText = Pick<Product, 'name' | 'brand' | 'barcode'>;

export function parseProductName(raw: string): ParsedText<string> {
  if (raw.length > MAX_PRODUCT_NAME_LENGTH) return null;
  return parseNormalizedProductName(raw);
}

// Normalize and validate only the stored form. MCP separately reports its raw
// maximum through Zod, including when both raw and normalized values are long.
export function parseNormalizedProductName(raw: string): ParsedText<string> {
  const value = normalizeProductName(raw);
  return value.length === 0 || value.length > MAX_PRODUCT_NAME_LENGTH ? null : { value };
}

export function parseProductBrand(raw: string | null): ParsedText<string | null> {
  if (raw !== null && raw.length > MAX_PRODUCT_BRAND_LENGTH) return null;
  return parseNormalizedProductBrand(raw);
}

export function parseNormalizedProductBrand(raw: string | null): ParsedText<string | null> {
  const value = normalizeBrandName(raw);
  return value !== null && value.length > MAX_PRODUCT_BRAND_LENGTH ? null : { value };
}

export function parseProductBarcode(raw: string | null): ParsedText<string | null> {
  if (raw !== null && raw.length > MAX_PRODUCT_BARCODE_LENGTH) return null;
  const value = raw?.trim() ?? '';
  return { value: value === '' ? null : value };
}

export function parseProductText(raw: ProductText): ProductText | null {
  const name = parseProductName(raw.name);
  const brand = parseProductBrand(raw.brand);
  const barcode = parseProductBarcode(raw.barcode);
  if (name === null || brand === null || barcode === null) return null;
  return { name: name.value, brand: brand.value, barcode: barcode.value };
}
