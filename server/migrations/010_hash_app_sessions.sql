-- The migration runner applies the schema change, all hashes and its marker
-- in one transaction. Existing bearers retain their owners and timestamps.
ALTER TABLE sessions RENAME COLUMN token TO token_hash;
UPDATE sessions SET token_hash = kcal_session_token_hash(token_hash);
