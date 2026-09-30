-- Multi-language product names.
--
-- The `name` column stays the canonical English name. `name_lt` and `name_ru`
-- hold the optional Lithuanian and Russian translations. Both are nullable —
-- when empty the frontend falls back to `name`.
--
-- Run once. Not idempotent (plain ALTER TABLE).

ALTER TABLE products
    ADD COLUMN name_lt VARCHAR(100) DEFAULT NULL,
    ADD COLUMN name_ru VARCHAR(100) DEFAULT NULL;
