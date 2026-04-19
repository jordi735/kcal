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
    selectWithUser: db.prepare(`
      SELECT
        s.user_id      AS user_id,
        s.expires_at   AS expires_at,
        u.id           AS id,
        u.email        AS email,
        u.goal_kcal    AS goal_kcal,
        u.goal_protein AS goal_protein,
        u.goal_carbs   AS goal_carbs,
        u.goal_fat     AS goal_fat
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `),
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
    selectGoals: db.prepare(
      'SELECT goal_kcal, goal_protein, goal_carbs, goal_fat FROM users WHERE id = ?',
    ),
    updateGoals: db.prepare(
      'UPDATE users SET goal_kcal = ?, goal_protein = ?, goal_carbs = ?, goal_fat = ? WHERE id = ?',
    ),
  },

  products: {
    // (user_id, name_pattern, brand_pattern)
    search: db.prepare(`
      SELECT ${PRODUCT_COLS}
      FROM products
      WHERE created_by = ?
        AND (name LIKE ? OR (brand IS NOT NULL AND brand LIKE ?))
      ORDER BY name COLLATE NOCASE ASC
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
      LIMIT 20
    `),
    // (user_id, barcode)
    byBarcode: db.prepare(`
      SELECT ${PRODUCT_COLS}
      FROM products
      WHERE created_by = ? AND barcode = ?
      LIMIT 1
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
    // (user_id, name) — seed idempotency check.
    existsByNameForUser: db.prepare(
      'SELECT 1 AS hit FROM products WHERE created_by = ? AND name = ?',
    ),
    // (user_id, id) — lightweight ownership existence check.
    ownedByUser: db.prepare(
      'SELECT 1 AS hit FROM products WHERE created_by = ? AND id = ?',
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
        SUM(e.grams * p.fat_per100     / 100.0)   AS fat,
        COUNT(*)                                  AS entry_count
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
    // (user_id, id)
    delete: db.prepare(
      'DELETE FROM entries WHERE user_id = ? AND id = ?',
    ),
    // (user_id, product_id)
    recentGrams: db.prepare(`
      SELECT DISTINCT grams
      FROM entries
      WHERE user_id = ? AND product_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `),
  },
} as const;
