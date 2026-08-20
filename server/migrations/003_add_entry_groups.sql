-- Day-scoped presentation groups for folding several logged entries under one
-- named parent. Entries remain the nutritional source of truth.

CREATE TABLE entry_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT    NOT NULL,
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  created_at INTEGER NOT NULL
);

ALTER TABLE entries
  ADD COLUMN group_id INTEGER REFERENCES entry_groups(id) ON DELETE SET NULL;

CREATE INDEX idx_entry_groups_user_date ON entry_groups(user_id, local_date);
CREATE INDEX idx_entries_user_group     ON entries(user_id, group_id);
