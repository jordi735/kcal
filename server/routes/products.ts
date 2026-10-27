// GET /products/search, /products/recent, /products/all, /products/barcode/:code.
// POST /products, PUT /products/:id for creating/editing the authed user's products.
// POST /products/adopt/:id clones a barcoded cross-user product into the caller's
// own row (idempotent on barcode).
// Every query scoped by req.userId (created_by). Macros are computed on read via
// the entries JOIN, so PUT automatically updates past days' totals retroactively.

import { Router } from 'express';
import {
  MAX_PRODUCT_BARCODE_LENGTH, MAX_PRODUCT_KCAL_PER100, MAX_PRODUCT_MACRO_GRAMS_PER100,
  MAX_PRODUCT_SEARCH_QUERY_LENGTH,
} from '../../shared/constraints.js';
import { authMiddleware } from '../auth.js';
import { parseProductText } from '../../shared/productText.js';
import { isObject } from '../guards.js';
import { log } from '../log.js';
import {
  adoptProduct, listOwnProducts, lookupBarcode, searchGlobalProducts, searchOwnProducts, searchProductPage,
} from '../products.js';
import { parsePositiveInt } from '../util.js';
import { handleWriteError } from '../middleware/write-error.js';
import { createProduct, deleteProduct, updateProduct } from '../writes.js';
import type {
  BarcodeLookupResponse,
  NewProductBody,
  UpdateProductBody,
} from '../types.js';

export const productsRouter: Router = Router();

productsRouter.use(authMiddleware);

productsRouter.get('/search', (req, res) => {
  const rawQ = req.query.q;
  if (typeof rawQ === 'string' && rawQ.length > MAX_PRODUCT_SEARCH_QUERY_LENGTH) {
    res.status(400).json({ error: 'invalid_query' });
    return;
  }
  const q = typeof rawQ === 'string' ? rawQ.trim() : '';
  if (q === '') {
    res.json([]);
    return;
  }
  // ?global=1 opts into the blended catalog (own + cross-user barcoded).
  // Default (absent/any-other-value) returns own-library only.
  const rawGlobal = req.query.global;
  const global = typeof rawGlobal === 'string' && rawGlobal === '1';
  if (global) {
    res.json(searchGlobalProducts(req.userId!, q));
    return;
  }
  res.json(searchOwnProducts(req.userId!, q));
});

productsRouter.get('/recent', (req, res) => {
  res.json(searchProductPage(req.userId!, { sort: 'recent', limit: 20, offset: 0 }).products);
});

productsRouter.get('/all', (req, res) => {
  res.json(listOwnProducts(req.userId!));
});

productsRouter.get('/barcode/:code', (req, res) => {
  const code = req.params.code.trim();
  if (code === '' || code.length > MAX_PRODUCT_BARCODE_LENGTH) {
    res.status(400).json({ error: 'invalid_barcode' });
    return;
  }
  const found = lookupBarcode(req.userId!, code);
  const own = found.products[0];
  if (own !== undefined) {
    const response: BarcodeLookupResponse = { kind: 'own', product: own };
    res.json(response);
    return;
  }
  if (found.template !== null) {
    const response: BarcodeLookupResponse = {
      kind: 'template',
      template: found.template,
    };
    res.json(response);
    return;
  }
  res.status(404).json({ error: 'not_found' });
});

productsRouter.post('/adopt/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const result = adoptProduct(req.userId!, id);
  if (result.created) {
    log.info('product adopted', {
      userId: req.userId,
      sourceId: id,
      productId: result.product.id,
    });
  }
  res.status(result.created ? 201 : 200).json(result.product);
});

// Per-macro caps: kcal ≤ 2000 per 100g (pure fat is 900 kcal/100g, so 2000 is a
// comfortable ceiling); protein/carbs/fat ≤ 200 because >100 would require the
// product to be pure protein/fat + something, tolerating rounding.
function isPer100(v: unknown): v is { kcal: number; protein: number; carbs: number; fat: number } {
  if (!isObject(v)) return false;
  const { kcal, protein, carbs, fat } = v;
  return (
    typeof kcal === 'number' && Number.isFinite(kcal) && kcal >= 0 && kcal <= MAX_PRODUCT_KCAL_PER100 &&
    typeof protein === 'number' && Number.isFinite(protein) && protein >= 0 && protein <= MAX_PRODUCT_MACRO_GRAMS_PER100 &&
    typeof carbs === 'number' && Number.isFinite(carbs) && carbs >= 0 && carbs <= MAX_PRODUCT_MACRO_GRAMS_PER100 &&
    typeof fat === 'number' && Number.isFinite(fat) && fat >= 0 && fat <= MAX_PRODUCT_MACRO_GRAMS_PER100
  );
}

function isProductBaseBody(v: unknown): v is UpdateProductBody {
  if (!isObject(v)) return false;
  const { name, brand, unit, barcode } = v;
  if (typeof name !== 'string') return false;
  if (brand !== null && typeof brand !== 'string') return false;
  if (unit !== 'g' && unit !== 'ml') return false;
  if (barcode !== null && typeof barcode !== 'string') return false;
  if (parseProductText({ name, brand, barcode }) === null) return false;
  if (!isPer100(v.per100)) return false;
  return true;
}

function isNewProductBody(v: unknown): v is NewProductBody {
  return isProductBaseBody(v) && typeof (v as { is_temp?: unknown }).is_temp === 'boolean';
}

productsRouter.post('/', (req, res) => {
  if (!isNewProductBody(req.body)) {
    res.status(400).json({ error: 'invalid_product' });
    return;
  }
  const product = createProduct(req.userId!, req.body);
  log.info('product created', { userId: req.userId, productId: product.id, isTemp: product.is_temp });
  res.status(201).json(product);
});

productsRouter.put('/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  if (!isProductBaseBody(req.body)) {
    res.status(400).json({ error: 'invalid_product' });
    return;
  }
  const product = updateProduct(req.userId!, id, req.body);
  log.info('product updated', { userId: req.userId, productId: id });
  res.json(product);
});

// Destructive: removes the product AND every entry this user logged against it
// (macros are computed at read time via JOIN, so the entries would orphan
// otherwise and the ON DELETE RESTRICT FK would block the product DELETE).
// Scoped by created_by, so adopted copies count as owned and the source row
// plus any other user's adopted copies are untouched.
productsRouter.delete('/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const result = deleteProduct(req.userId!, id);
  log.info('product deleted', { userId: req.userId, productId: id, entryCount: result.deleted_entry_count });
  res.json({ ok: true });
});

productsRouter.use(handleWriteError);
