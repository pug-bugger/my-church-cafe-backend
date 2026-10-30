-- Sign in with Kreo (the church's people directory, kreo.atsinaujinimas.lt).
--
-- `user_kreo_accounts` links an app account to one Kreo person, keyed by
-- Kreo's person id — never by email, which can change on either side. One
-- Kreo person per app account and vice versa (both UNIQUE). `email` is only
-- what Kreo reported when the link was made.
--
-- `users.password_hash` becomes nullable (as in migration_google_accounts):
-- an account first created through Kreo has no password of its own.
--
-- Safe to run more than once (CREATE TABLE IF NOT EXISTS; MODIFY is
-- idempotent). Restart the backend afterwards: the routes probe for the table
-- once per process.

ALTER TABLE users
    MODIFY COLUMN password_hash VARCHAR(255) NULL;

CREATE TABLE IF NOT EXISTS user_kreo_accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    kreo_person_id INT NOT NULL,
    email VARCHAR(255) NULL,
    linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_kreo_accounts_user (user_id),
    UNIQUE KEY uq_user_kreo_accounts_person (kreo_person_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
