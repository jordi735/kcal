-- Standardize before-weigh-in bathroom notes. Existing records use the same
-- defaults as new weigh-ins: Peed checked and Pooped unchecked.
ALTER TABLE weights ADD COLUMN peed INTEGER NOT NULL DEFAULT 1 CHECK (peed IN (0, 1));
ALTER TABLE weights ADD COLUMN pooped INTEGER NOT NULL DEFAULT 0 CHECK (pooped IN (0, 1));
