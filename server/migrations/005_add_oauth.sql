CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  metadata TEXT NOT NULL
);

CREATE TABLE oauth_requests (
  id_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id),
  redirect_uri TEXT NOT NULL,
  state TEXT,
  challenge TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT UNIQUE
);

CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id),
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE oauth_tokens (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX oauth_tokens_grant ON oauth_tokens(grant_id);
CREATE INDEX oauth_requests_expiry ON oauth_requests(expires_at);
CREATE INDEX oauth_grants_expiry ON oauth_grants(expires_at);
