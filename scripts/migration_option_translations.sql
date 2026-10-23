-- Multi-language drink option names.
--
-- Same shape as migration_product_translations: `drink_option_definitions.name`
-- and `drink_option_values.label` stay the canonical English text, and the new
-- columns hold optional Lithuanian and Russian translations. NULL falls back to
-- the English text.
--
-- The English text is what orders store and what the kitchen ticket prints, so
-- the barista reads one language whatever the terminal was showing.
--
-- Run once. Not idempotent (plain ALTER TABLE).

ALTER TABLE drink_option_definitions
    ADD COLUMN name_lt VARCHAR(100) DEFAULT NULL,
    ADD COLUMN name_ru VARCHAR(100) DEFAULT NULL;

ALTER TABLE drink_option_values
    ADD COLUMN label_lt VARCHAR(100) DEFAULT NULL,
    ADD COLUMN label_ru VARCHAR(100) DEFAULT NULL;
