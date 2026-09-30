-- Customer cards: the QR code a customer shows at the counter.
--
-- `users.card_code` is a random, unguessable code the mobile app renders as a
-- QR (`cc:card:<code>`). It is issued lazily, the first time someone opens
-- their card, so existing accounts need no backfill. The owner can reset it,
-- which kills any screenshot of the old one. NULLs don't collide in a UNIQUE
-- index, so every account without a card yet is fine.
--
-- `orders.customer_user_id` is who the order is *for*. `orders.user_id` keeps
-- meaning who *entered* it — on the terminal that is the barista, which is why
-- the customer needs a column of their own. Set when the terminal scans a card
-- (or when a non-staff account places its own order); NULL for a walk-up
-- customer whose name was typed.
--
-- Run once. Not idempotent (plain ALTER TABLE). Restart the backend afterwards:
-- the routes probe for these columns once per process.

ALTER TABLE users
    ADD COLUMN card_code VARCHAR(32) NULL,
    ADD UNIQUE KEY uq_users_card_code (card_code);

ALTER TABLE orders
    ADD COLUMN customer_user_id INT NULL AFTER user_id,
    ADD CONSTRAINT fk_orders_customer_user
        FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE SET NULL,
    ADD INDEX idx_orders_customer_user (customer_user_id, created_at);
