// GET /products/search, /products/recent, /products/all, /products/barcode/:code.
// POST /products, PUT /products/:id for creating/editing the authed user's products.
// POST /products/adopt/:id clones a barcoded cross-user product into the caller's
// own row (idempotent on barcode).
// POST /products/from-image runs AI label extraction — multer memory storage scoped
// to this route, daily per-user cap tracked in memory.
// Every query scoped by req.userId (created_by). Macros are computed on read via
// the entries JOIN, so PUT automatically updates past days' totals retroactively.

import { Router } from 'express';
import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { authMiddleware } from '../auth.js';
import { extractNutrition, InvalidExtractionError } from '../codex.js';
import { env } from '../env.js';
import { isObject } from '../guards.js';
import { log } from '../log.js';
import { rowToProduct, searchOwnProducts } from '../reads.js';
import { statements } from '../statements.js';
import { parsePositiveInt } from '../util.js';
import { createProduct, deleteProduct, updateProduct, WriteError } from '../writes.js';
import type {
  BarcodeLookupResponse,
  NewProductBody,
  Product,
  ProductRow,
  ProductRowWithOwner,
  ProductSearchRow,
  ProductTemplate,
  ScanTally,
  UpdateProductBody,
} from '../types.js';

export const productsRouter: Router = Router();

productsRouter.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB — typical phone JPEGs are 2–4 MB.
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(null, false);
  },
});

const scanTally = new Map<number, ScanTally>();
const DAILY_CAP = env.AI_SCAN_DAILY_CAP;

function utcDateKey(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function checkAndBumpQuota(userId: number): boolean {
  const today = utcDateKey();
  const row = scanTally.get(userId);
  if (row === undefined || row.date !== today) {
    scanTally.set(userId, { date: today, count: 1 });
    return true;
  }
  if (row.count >= DAILY_CAP) return false;
  row.count += 1;
  return true;
}

function searchRowToProduct(r: ProductSearchRow): Product {
  return { ...rowToProduct(r), is_mine: r.is_mine === 1 };
}

// Build the cross-user prefill payload by hand so created_by/id/is_temp can't
// leak — the source row carries fields we must not expose to the scanning user.
function rowToTemplate(r: ProductRow): ProductTemplate {
  return {
    name: r.name,
    brand: r.brand,
    unit: r.unit === 'ml' ? 'ml' : 'g',
    barcode: r.barcode,
    per100: {
      kcal: r.kcal_per100,
      protein: r.protein_per100,
      carbs: r.carbs_per100,
      fat: r.fat_per100,
    },
  };
}

productsRouter.get('/search', (req, res) => {
  const rawQ = req.query.q;
  const q = typeof rawQ === 'string' ? rawQ.trim() : '';
  if (q === '') {
    res.json([]);
    return;
  }
  const pattern = `%${q}%`;
  // ?global=1 opts into the blended catalog (own + cross-user barcoded).
  // Default (absent/any-other-value) returns own-library only.
  const rawGlobal = req.query.global;
  const global = typeof rawGlobal === 'string' && rawGlobal === '1';
  if (global) {
    const rows = statements.products.search.all(
      pattern,
      pattern,
      req.userId!,
      req.userId!,
      req.userId!,
    ) as ProductSearchRow[];
    res.json(rows.map(searchRowToProduct));
    return;
  }
  res.json(searchOwnProducts(req.userId!, q));
});

productsRouter.get('/recent', (req, res) => {
  const rows = statements.products.recent.all(req.userId!, req.userId!) as ProductRow[];
  res.json(rows.map(rowToProduct));
});

productsRouter.get('/all', (req, res) => {
  const rows = statements.products.all.all(req.userId!) as ProductRow[];
  res.json(rows.map(rowToProduct));
});

productsRouter.get('/barcode/:code', (req, res) => {
  const code = req.params.code.trim();
  if (code === '') {
    res.status(400).json({ error: 'invalid_barcode' });
    return;
  }
  const own = statements.products.byBarcode.get(req.userId!, code) as ProductRow | undefined;
  if (own !== undefined) {
    const response: BarcodeLookupResponse = { kind: 'own', product: rowToProduct(own) };
    res.json(response);
    return;
  }
  const template = statements.products.byBarcodeAnyUser.get(code) as ProductRow | undefined;
  if (template !== undefined) {
    const response: BarcodeLookupResponse = {
      kind: 'template',
      template: rowToTemplate(template),
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
  const source = statements.products.byIdAnyUser.get(id) as ProductRowWithOwner | undefined;
  if (source === undefined) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  // Privacy guard: only barcoded products can be adopted. Without this, the
  // numeric :id would let any user clone any other user's private products.
  if (source.barcode === null) {
    res.status(400).json({ error: 'not_adoptable' });
    return;
  }
  if (source.created_by === req.userId) {
    res.json(rowToProduct(source));
    return;
  }
  // Idempotent: if the user already owns a row with this barcode, return it
  // instead of creating a duplicate.
  const existing = statements.products.byBarcode.get(req.userId!, source.barcode) as
    | ProductRow
    | undefined;
  if (existing !== undefined) {
    res.json(rowToProduct(existing));
    return;
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
    req.userId!,
    Date.now(),
  ) as { lastInsertRowid: number | bigint };
  const row = statements.products.selectById.get(req.userId!, Number(result.lastInsertRowid)) as
    | ProductRow
    | undefined;
  if (row === undefined) {
    res.status(500).json({ error: 'insert_failed' });
    return;
  }
  log.info('product adopted', {
    userId: req.userId,
    sourceId: source.id,
    productId: row.id,
  });
  res.status(201).json(rowToProduct(row));
});

// Per-macro caps: kcal ≤ 2000 per 100g (pure fat is 900 kcal/100g, so 2000 is a
// comfortable ceiling); protein/carbs/fat ≤ 200 because >100 would require the
// product to be pure protein/fat + something, tolerating rounding.
function isPer100(v: unknown): v is { kcal: number; protein: number; carbs: number; fat: number } {
  if (!isObject(v)) return false;
  const { kcal, protein, carbs, fat } = v;
  return (
    typeof kcal === 'number' && Number.isFinite(kcal) && kcal >= 0 && kcal <= 2000 &&
    typeof protein === 'number' && Number.isFinite(protein) && protein >= 0 && protein <= 200 &&
    typeof carbs === 'number' && Number.isFinite(carbs) && carbs >= 0 && carbs <= 200 &&
    typeof fat === 'number' && Number.isFinite(fat) && fat >= 0 && fat <= 200
  );
}

function isProductBaseBody(v: unknown): v is UpdateProductBody {
  if (!isObject(v)) return false;
  const { name, brand, unit, barcode } = v;
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) return false;
  if (brand !== null && (typeof brand !== 'string' || brand.length > 120)) return false;
  if (unit !== 'g' && unit !== 'ml') return false;
  if (barcode !== null && (typeof barcode !== 'string' || barcode.length > 64)) return false;
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
  res.status(201).json(createProduct(req.userId!, req.body));
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
  res.json(updateProduct(req.userId!, id, req.body));
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
  deleteProduct(req.userId!, id);
  res.json({ ok: true });
});

productsRouter.post('/from-image', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'missing_image' });
      return;
    }
    if (!checkAndBumpQuota(req.userId!)) {
      log.warn('ai quota exceeded', { userId: req.userId });
      res.status(429).json({ error: 'daily_cap_exceeded' });
      return;
    }
    const result = await extractNutrition(req.file.buffer, req.file.mimetype);
    res.json(result);
  } catch (err) {
    if (err instanceof InvalidExtractionError) {
      res.status(422).json({ error: 'invalid_extraction' });
      return;
    }
    next(err);
  }
});

const handleWriteError: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (err instanceof WriteError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
};

productsRouter.use(handleWriteError);
