-- KCAL initial schema
-- Five tables per plan: users, sessions, products, entries (+ schema_migrations is runner-managed).
-- Magic-link tokens live only in memory; not persisted here.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  goal_kcal     INTEGER NOT NULL DEFAULT 2400,
  goal_protein  INTEGER NOT NULL DEFAULT 180,
  goal_carbs    INTEGER NOT NULL DEFAULT 240,
  goal_fat      INTEGER NOT NULL DEFAULT 80,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  brand          TEXT,
  unit           TEXT    NOT NULL CHECK (unit IN ('g', 'ml')),
  barcode        TEXT,
  kcal_per100    REAL    NOT NULL,
  protein_per100 REAL    NOT NULL,
  carbs_per100   REAL    NOT NULL,
  fat_per100     REAL    NOT NULL,
  is_temp        INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  grams      REAL    NOT NULL,
  local_date TEXT    NOT NULL,
  local_time TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user         ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_products_name         ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_barcode      ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entries_user_date     ON entries(user_id, local_date);
CREATE INDEX IF NOT EXISTS idx_entries_user_recent   ON entries(user_id, created_at DESC);
