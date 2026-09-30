-- Sign in with Google.
--
-- `user_google_accounts` links an app account to one Google account, keyed by
-- Google's stable subject id (`sub`) — never by email, which a Google user can
-- change. One Google account per app account and vice versa (both UNIQUE).
-- `email` is only what Google reported when the link was made, shown in
-- Settings so people can tell which Google account is connected; it can
-- differ from `users.email`.
--
-- `users.password_hash` becomes nullable: an account first created through
-- Google has no password. Password sign-in rejects such an account, and it
-- can't unlink Google until it sets a password (it would lock itself out).
--
-- Safe to run more than once (CREATE TABLE IF NOT EXISTS; MODIFY is
-- idempotent). Restart the backend afterwards: the routes probe for the table
-- once per process.

ALTER TABLE users
    MODIFY COLUMN password_hash VARCHAR(255) NULL;

CREATE TABLE IF NOT EXISTS user_google_accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    google_sub VARCHAR(64) NOT NULL,
    email VARCHAR(255) NULL,
    linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_google_accounts_user (user_id),
    UNIQUE KEY uq_user_google_accounts_sub (google_sub),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
