-- Free-form settings the cafe edits from the app, one row per key.
--
-- The first one is `menu_note`: a short line admins write under the menu board
-- ("Any drink can be made with oat milk", "Ask us about decaf"). It is a
-- key/value table rather than a column somewhere because it belongs to no row
-- that already exists, and the next setting of this kind should not need a
-- migration of its own.
--
-- Safe to run more than once (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
    setting_value TEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
