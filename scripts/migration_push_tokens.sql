-- Expo push tokens, one row per device that has allowed notifications.
--
-- A user can hold several (a phone and a tablet). The token is unique, not the
-- (user, token) pair: when a device signs into another account its token moves
-- to that account, so a shared tablet never pushes the previous owner's orders.
--
-- `language` is the app language on that device when it registered. The server
-- writes the notification text, so it has to know which language to write it in.
--
-- Safe to run more than once (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS user_push_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(255) NOT NULL,
    platform ENUM('ios', 'android') NOT NULL,
    language VARCHAR(8) NOT NULL DEFAULT 'en',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_push_tokens_token (token),
    KEY idx_user_push_tokens_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
