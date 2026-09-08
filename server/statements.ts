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
  g.id AS group_id, g.name AS group_name,
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
  LEFT JOIN entry_groups g
    ON g.id = e.group_id
   AND g.user_id = e.user_id
   AND g.local_date = e.local_date
`;

export const statements = {
  oauth: {
    // Clients are protocol identities, not app users. SDK client auth needs a
    // retrievable client secret; never expose this metadata through app/MCP reads.
    client: db.prepare('SELECT metadata FROM oauth_clients WHERE id = ?'), // (client_id)
    insertClient: db.prepare('INSERT INTO oauth_clients (id, metadata) VALUES (?, ?)'), // (id, JSON)
    // (id_hash, browser_hash, client_id, redirect_uri, state, challenge, resource, expires_at)
    insertRequest: db.prepare(`INSERT INTO oauth_requests
      (id_hash, browser_hash, client_id, redirect_uri, state, challenge, resource, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    // (id_hash, browser_hash, now) — an unapproved request belongs to a browser.
    pendingRequest: db.prepare(`SELECT * FROM oauth_requests
      WHERE id_hash = ? AND browser_hash = ? AND expires_at > ? AND code_hash IS NULL`),
    // (user_id, code_hash, expires_at, id_hash)
    approveRequest: db.prepare(`UPDATE oauth_requests SET user_id = ?, code_hash = ?, expires_at = ? WHERE id_hash = ?`),
    deleteRequest: db.prepare('DELETE FROM oauth_requests WHERE id_hash = ?'), // (id_hash)
    // (client_id, code_hash, now)
    code: db.prepare('SELECT * FROM oauth_requests WHERE client_id = ? AND code_hash = ? AND expires_at > ?'),
    // (id, user_id, client_id, resource, expires_at)
    insertGrant: db.prepare(`INSERT INTO oauth_grants (id, user_id, client_id, resource, expires_at) VALUES (?, ?, ?, ?, ?)`),
    // (hash, grant_id, kind, expires_at)
    insertToken: db.prepare('INSERT INTO oauth_tokens (hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)'),
    // (hash) — the credential resolves its own owner; callers cannot select one.
    token: db.prepare(`SELECT t.kind, t.used, t.expires_at AS token_expires_at,
      g.id, g.user_id, g.client_id, g.resource, g.expires_at, g.revoked
      FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.hash = ?`),
    useRefresh: db.prepare('UPDATE oauth_tokens SET used = 1 WHERE hash = ?'), // (hash)
    revokeGrant: db.prepare('UPDATE oauth_grants SET revoked = 1 WHERE client_id = ? AND id = ?'), // (client_id, grant_id)
    cleanRequests: db.prepare('DELETE FROM oauth_requests WHERE expires_at <= ?'), // (now)
    cleanGrants: db.prepare('DELETE FROM oauth_grants WHERE expires_at <= ?'), // (now), cascades token history
    // Retain used refresh tokens until grant expiry to detect replay.
    cleanAccess: db.prepare("DELETE FROM oauth_tokens WHERE kind = 'access' AND expires_at <= ?"), // (now)
  },
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
    selectEmailById: db.prepare('SELECT email FROM users WHERE id = ?'), // (user_id)
    upsert: db.prepare(`
      INSERT INTO users (email, goal_kcal, goal_protein, goal_carbs, goal_fat, created_at)
      VALUES (?, 2400, 180, 240, 80, ?)
      ON CONFLICT(email) DO NOTHING
    `),
    selectByEmail: db.prepare(`
      SELECT id, email, goal_kcal, goal_protein, goal_carbs, goal_fat
      FROM users WHERE email = ?
    `),
    selectGoalsById: db.prepare(`
      SELECT goal_kcal, goal_protein, goal_carbs, goal_fat
      FROM users WHERE id = ?
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

  entryGroups: {
    // (user_id, local_date, name, created_at)
    insert: db.prepare(`
      INSERT INTO entry_groups (user_id, local_date, name, created_at)
      VALUES (?, ?, ?, ?)
    `),
    // (user_id, id)
    selectById: db.prepare(`
      SELECT id, user_id, local_date, name, created_at
      FROM entry_groups
      WHERE user_id = ? AND id = ?
    `),
    // (name, user_id, id)
    updateName: db.prepare(
      'UPDATE entry_groups SET name = ? WHERE user_id = ? AND id = ?',
    ),
    // (user_id, id)
    delete: db.prepare(
      'DELETE FROM entry_groups WHERE user_id = ? AND id = ?',
    ),
    // (user_id, user_id) — remove empty/singleton groups after product deletion.
    deleteTooSmallForUser: db.prepare(`
      DELETE FROM entry_groups
      WHERE user_id = ?
        AND (
          SELECT COUNT(*)
          FROM entries e
          WHERE e.user_id = ? AND e.group_id = entry_groups.id
        ) < 2
    `),
  },

  entries: {
    // (user_id, local_date)
    selectForDay: db.prepare(`
      SELECT ${ENTRY_WITH_PRODUCT_COLS}
      ${ENTRY_JOIN_FROM}
      WHERE e.user_id = ? AND e.local_date = ?
      ORDER BY e.id ASC
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
    // (user_id, id) — lightweight row used by transactional group membership
    // validation and delete cleanup.
    selectMembershipById: db.prepare(`
      SELECT id, local_date, group_id
      FROM entries
      WHERE user_id = ? AND id = ?
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
    // (group_id, user_id, id) — creation-only assignment; the NULL guard
    // prevents concurrent regrouping from silently stealing an entry.
    assignGroup: db.prepare(
      'UPDATE entries SET group_id = ? WHERE user_id = ? AND id = ? AND group_id IS NULL',
    ),
    // (tagged, user_id, group_id)
    updateTaggedForGroup: db.prepare(
      'UPDATE entries SET tagged = ? WHERE user_id = ? AND group_id = ?',
    ),
    // (user_id, group_id)
    countForGroup: db.prepare(`
      SELECT COUNT(*) AS count
      FROM entries
      WHERE user_id = ? AND group_id = ?
    `),
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

  weights: {
    // (user_id, start_date, end_date, limit, offset) — inclusive, newest first.
    inRange: db.prepare(`
      SELECT id, local_date, weight_kg, note
      FROM weights
      WHERE user_id = ? AND local_date >= ? AND local_date <= ?
      ORDER BY local_date DESC
      LIMIT ? OFFSET ?
    `),
    // (user_id)
    all: db.prepare(`
      SELECT id, local_date, weight_kg, note
      FROM weights
      WHERE user_id = ?
      ORDER BY local_date DESC
    `),
    // (user_id, id)
    selectById: db.prepare(`
      SELECT id, local_date, weight_kg, note
      FROM weights
      WHERE user_id = ? AND id = ?
    `),
    // (user_id, local_date, weight_kg, note, created_at)
    insert: db.prepare(`
      INSERT INTO weights (user_id, local_date, weight_kg, note, created_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    // (local_date, weight_kg, note, user_id, id)
    update: db.prepare(`
      UPDATE weights
      SET local_date = ?, weight_kg = ?, note = ?
      WHERE user_id = ? AND id = ?
    `),
    // (user_id, id)
    delete: db.prepare(
      'DELETE FROM weights WHERE user_id = ? AND id = ?',
    ),
  },
} as const;
