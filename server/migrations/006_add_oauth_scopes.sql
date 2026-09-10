-- Existing connections retain read-only access. Scope narrowing belongs to a
-- token lineage, while the grant records the user's original approved ceiling.
ALTER TABLE oauth_requests ADD COLUMN scopes TEXT NOT NULL DEFAULT 'kcal:read'
  CHECK (scopes IN ('kcal:read', 'kcal:read kcal:write'));
ALTER TABLE oauth_grants ADD COLUMN scopes TEXT NOT NULL DEFAULT 'kcal:read'
  CHECK (scopes IN ('kcal:read', 'kcal:read kcal:write'));
ALTER TABLE oauth_tokens ADD COLUMN scopes TEXT NOT NULL DEFAULT 'kcal:read'
  CHECK (scopes IN ('kcal:read', 'kcal:read kcal:write'));
