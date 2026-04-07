-- Add profile picture URL for users (run once on existing DBs)
USE church_cafe;

ALTER TABLE users
  ADD COLUMN picture_url VARCHAR(512) NULL
  AFTER password_hash;
