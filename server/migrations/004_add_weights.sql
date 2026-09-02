-- One private, date-only weigh-in per user. Weight is stored in kilograms;
-- the API additionally enforces the feature's one-decimal precision rule.

CREATE TABLE weights (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT    NOT NULL,
  weight_kg  REAL    NOT NULL CHECK (weight_kg >= 0.1 AND weight_kg <= 1000.0),
  note       TEXT    CHECK (note IS NULL OR length(note) <= 500),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, local_date)
);
