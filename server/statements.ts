// Every application-level prepared statement, grouped by domain.
// Migration-bookkeeping statements live in db.ts itself — they run during
// bootstrap before this module can load.
//
// Convention: user-scoped reads/writes take `user_id` as the FIRST parameter,
// then the resource id. The WHERE clauses follow the same order.

import { db } from './db.js';

const PRODUCT_COLS =
  'id, name, brand, unit, barcode, kcal_per100, protein_per100, carbs_per100, fat_per100, is_temp';

// Same columns as PRODUCT_COLS, qualified with the `p` table alias — the only
// query that needs this (products.recent) joins entries and aliases products.
const PRODUCT_COLS_P =
  'p.id, p.name, p.brand, p.unit, p.barcode, p.kcal_per100, p.protein_per100, p.carbs_per100, p.fat_per100, p.is_temp';

// Columns for the entries-JOIN-products shape, with `p_` prefixes so the
// result row can be deserialised into EntryJoinRow without collisions.
const ENTRY_WITH_PRODUCT_COLS = `
  e.id AS id, e.grams AS grams, e.local_date AS local_date, e.local_time AS local_time,
  e.tagged AS tagged,
  p.id AS p_id, p.name AS p_name, p.brand AS p_brand, p.unit AS p_unit, p.barcode AS p_barcode,
  p.kcal_per100    AS p_kcal_per100,
  p.protein_per100 AS p_protein_per100,
  p.carbs_per100   AS p_carbs_per100,
  p.fat_per100     AS p_fat_per100,
  p.is_temp        AS p_is_temp
`;

const ENTRY_JOIN_FROM = `
  FROM entries e
  JOIN products p ON p.id = e.product_id
`;

export const statements = {
  sessions: {
    insert: db.prepare(
      'INSERT INTO sessions (token, user_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ),
    selectByToken: db.prepare(
      'SELECT user_id, expires_at FROM sessions WHERE token = ?',
    ),
    slide: db.prepare(
      'UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token = ?',
    ),
    delete: db.prepare('DELETE FROM sessions WHERE token = ?'),
  },

  users: {
    upsert: db.prepare(`
      INSERT INTO users (email, goal_kcal, goal_protein, goal_carbs, goal_fat, created_at)
      VALUES (?, 2400, 180, 240, 80, ?)
      ON CONFLICT(email) DO NOTHING
    `),
    selectByEmail: db.prepare(`
      SELECT id, email, goal_kcal, goal_protein, goal_carbs, goal_fat
      FROM users WHERE email = ?
    `),
    updateGoals: db.prepare(
      'UPDATE users SET goal_kcal = ?, goal_protein = ?, goal_carbs = ?, goal_fat = ? WHERE id = ?',
    ),
  },

  products: {
    // (user_id, name_pattern, brand_pattern) — default search scope: own only.
    // No is_mine projection — every row is tautologically the caller's own,
    // so the wire omits the flag (undefined client-side).
    searchOwn: db.prepare(`
      SELECT ${PRODUCT_COLS}
      FROM products
      WHERE created_by = ?
        AND is_temp = 0
        AND (name LIKE ? OR (brand IS NOT NULL AND brand LIKE ?))
      ORDER BY name COLLATE NOCASE ASC
      LIMIT 50
    `),
    // (name_pattern, brand_pattern, user_id, user_id, user_id)
    //   - patterns: name + brand LIKE
    //   - user_id #1: candidate filter (own OR has barcode)
    //   - user_id #2: ranking (own copy wins each barcode partition)
    //   - user_id #3: is_mine flag in the projection
    // The COALESCE(barcode, 'self-' || id) partition keeps non-barcoded rows
    // (which can only be the user's own per the candidates filter) ungrouped.
    // Outer ORDER BY sorts the user's own rows first (is_mine DESC), then
    // alphabetic — referenced by alias, no extra binding required.
    search: db.prepare(`
      WITH candidates AS (
        SELECT id, name, brand, unit, barcode,
               kcal_per100, protein_per100, carbs_per100, fat_per100,
               is_temp, created_by, created_at
        FROM products
        WHERE is_temp = 0
          AND (name LIKE ? OR (brand IS NOT NULL AND brand LIKE ?))
          AND (created_by = ? OR barcode IS NOT NULL)
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(barcode, 'self-' || id)
            ORDER BY
              CASE WHEN created_by = ? THEN 0 ELSE 1 END,
              created_at DESC
          ) AS rn
        FROM candidates
      )
      SELECT id, name, brand, unit, barcode,
             kcal_per100, protein_per100, carbs_per100, fat_per100, is_temp,
             (created_by = ?) AS is_mine
      FROM ranked
      WHERE rn = 1
      ORDER BY is_mine DESC, name COLLATE NOCASE ASC
      LIMIT 50
    `),
    // (user_id, user_id) — first for the inner subquery, second for the outer WHERE.
    recent: db.prepare(`
      SELECT ${PRODUCT_COLS_P}
      FROM products p
      INNER JOIN (
        SELECT product_id, MAX(created_at) AS last_used
        FROM entries
        WHERE user_id = ?
        GROUP BY product_id
      ) r ON r.product_id = p.id
      WHERE p.created_by = ? AND p.is_temp = 0
      ORDER BY r.last_used DESC
      LIMIT 20
    `),
    // (user_id)
    all: db.prepare(`
      SELECT ${PRODUCT_COLS}
      FROM products
      WHERE created_by = ? AND is_temp = 0
      ORDER BY name COLLATE NOCASE ASC
    `),
    // (user_id, barcode)
    byBarcode: db.prepare(`
      SELECT ${PRODUCT_COLS}
      FROM products
      WHERE created_by = ? AND barcode = ?
      LIMIT 1
    `),
    // (barcode) — cross-user template lookup; most recent non-temp wins.
    byBarcodeAnyUser: db.prepare(`
      SELECT ${PRODUCT_COLS}
      FROM products
      WHERE barcode = ? AND is_temp = 0
      ORDER BY created_at DESC
      LIMIT 1
    `),
    // (id) — fetch a source row for the adopt endpoint, regardless of owner.
    byIdAnyUser: db.prepare(`
      SELECT ${PRODUCT_COLS}, created_by
      FROM products
      WHERE id = ?
    `),
    // (name, brand, unit, barcode, kcal, protein, carbs, fat, is_temp, user_id, created_at)
    insert: db.prepare(`
      INSERT INTO products (name, brand, unit, barcode, kcal_per100, protein_per100, carbs_per100, fat_per100, is_temp, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    // (user_id, id)
    selectById: db.prepare(`
      SELECT ${PRODUCT_COLS}
      FROM products
      WHERE created_by = ? AND id = ?
    `),
    // (name, brand, unit, barcode, kcal, protein, carbs, fat, user_id, id)
    update: db.prepare(`
      UPDATE products
      SET name = ?, brand = ?, unit = ?, barcode = ?,
          kcal_per100 = ?, protein_per100 = ?, carbs_per100 = ?, fat_per100 = ?
      WHERE created_by = ? AND id = ?
    `),
    // (user_id, id) — lightweight ownership existence check.
    ownedByUser: db.prepare(
      'SELECT 1 AS hit FROM products WHERE created_by = ? AND id = ?',
    ),
    // (user_id, id) — user-scoped destructive. Paired with entries.deleteForProduct
    // inside a transaction because entries.product_id has ON DELETE RESTRICT.
    delete: db.prepare(
      'DELETE FROM products WHERE created_by = ? AND id = ?',
    ),
  },

  entries: {
    // (user_id, local_date)
    selectForDay: db.prepare(`
      SELECT ${ENTRY_WITH_PRODUCT_COLS}
      ${ENTRY_JOIN_FROM}
      WHERE e.user_id = ? AND e.local_date = ?
      ORDER BY e.local_time ASC, e.id ASC
    `),
    // (user_id, start_date, end_date)
    weekSum: db.prepare(`
      SELECT
        e.local_date                              AS date,
        SUM(e.grams * p.kcal_per100    / 100.0)   AS kcal,
        SUM(e.grams * p.protein_per100 / 100.0)   AS protein,
        SUM(e.grams * p.carbs_per100   / 100.0)   AS carbs,
        SUM(e.grams * p.fat_per100     / 100.0)   AS fat
      ${ENTRY_JOIN_FROM}
      WHERE e.user_id = ?
        AND e.local_date >= ?
        AND e.local_date <= ?
      GROUP BY e.local_date
    `),
    // (user_id, id)
    selectById: db.prepare(`
      SELECT ${ENTRY_WITH_PRODUCT_COLS}
      ${ENTRY_JOIN_FROM}
      WHERE e.user_id = ? AND e.id = ?
    `),
    // (user_id, product_id, grams, local_date, local_time, created_at)
    insert: db.prepare(`
      INSERT INTO entries (user_id, product_id, grams, local_date, local_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    // (grams, user_id, id)
    updateGrams: db.prepare(
      'UPDATE entries SET grams = ? WHERE user_id = ? AND id = ?',
    ),
    // (tagged, user_id, id)
    updateTagged: db.prepare(
      'UPDATE entries SET tagged = ? WHERE user_id = ? AND id = ?',
    ),
    // (user_id, id)
    delete: db.prepare(
      'DELETE FROM entries WHERE user_id = ? AND id = ?',
    ),
    // (user_id, product_id) — prunes every row referencing a to-be-deleted
    // product for this user. Runs before products.delete inside a transaction.
    deleteForProduct: db.prepare(
      'DELETE FROM entries WHERE user_id = ? AND product_id = ?',
    ),
    // (user_id, product_id) — one row per distinct grams, ordered by most
    // recent use of each. DISTINCT + ORDER BY over a non-projected column is
    // implementation-defined in SQLite and yielded first-use ordering.
    recentGrams: db.prepare(`
      SELECT grams
      FROM entries
      WHERE user_id = ? AND product_id = ?
      GROUP BY grams
      ORDER BY MAX(created_at) DESC
      LIMIT 5
    `),
  },
} as const;
