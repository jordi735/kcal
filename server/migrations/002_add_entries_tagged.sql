-- Per-entry tagged flag: check off items actually eaten vs still-planned.
-- Does not affect macros — purely a visual state on the entry list.

ALTER TABLE entries ADD COLUMN tagged INTEGER NOT NULL DEFAULT 0 CHECK (tagged IN (0, 1));
