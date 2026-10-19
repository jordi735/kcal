-- Existing goals are deliberately NOT backfilled into historical dates.
-- The authenticated app initializes a baseline using the user's timezone.
CREATE TABLE goal_history (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_date TEXT NOT NULL,
  kcal INTEGER NOT NULL CHECK (kcal BETWEEN 0 AND 20000),
  protein INTEGER NOT NULL CHECK (protein BETWEEN 0 AND 2000),
  carbs INTEGER NOT NULL CHECK (carbs BETWEEN 0 AND 2000),
  fat INTEGER NOT NULL CHECK (fat BETWEEN 0 AND 2000),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, effective_date)
);

CREATE TABLE mcp_creation_receipts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);

ALTER TABLE users ADD COLUMN mcp_notice_version INTEGER;
UPDATE users SET mcp_notice_version = 4
WHERE EXISTS (
  SELECT 1 FROM oauth_grants g
  WHERE g.user_id = users.id AND g.revoked = 0
    AND g.expires_at > unixepoch('subsec') * 1000
    AND EXISTS (
      SELECT 1 FROM oauth_tokens t
      WHERE t.grant_id = g.id AND t.expires_at > unixepoch('subsec') * 1000
        AND (t.kind = 'access' OR (t.kind = 'refresh' AND t.used = 0))
    )
);
