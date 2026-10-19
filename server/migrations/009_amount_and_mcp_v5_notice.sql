-- Amounts retain their numeric values and use each product's g/ml unit.
ALTER TABLE entries RENAME COLUMN grams TO amount;

-- A new tool contract warrants a fresh reminder, even after dismissing v4.
UPDATE users SET mcp_notice_version = 5
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
