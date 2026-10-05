-- Customer names typed on the terminal, offered back as suggestions while the
-- next one is typed (GET /api/customer-names). POST /api/orders adds a name the
-- first time it is used and bumps `use_count` / `last_used_at` after that.
--
-- One row per name per organization; `organization_id` 0 is "none" rather
-- than NULL so the unique key still holds. The utf8mb4_unicode_ci collation
-- makes that key case- and accent-insensitive: "anna" and "Anna" are one row.
--
-- Seeded from the names already on past orders, so suggestions work from day
-- one. Run after migration_order_customer_name and migration_organizations.
--
-- Safe to run more than once (CREATE TABLE IF NOT EXISTS, INSERT IGNORE).

CREATE TABLE IF NOT EXISTS customer_name_suggestions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT NOT NULL DEFAULT 0,
    name VARCHAR(100) NOT NULL,
    use_count INT NOT NULL DEFAULT 1,
    last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_customer_name_org (organization_id, name)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

INSERT IGNORE INTO customer_name_suggestions (organization_id, name, use_count, last_used_at)
SELECT COALESCE(organization_id, 0),
       LEFT(TRIM(customer_name), 100),
       COUNT(*),
       MAX(created_at)
  FROM orders
 WHERE customer_name IS NOT NULL
   AND TRIM(customer_name) <> ''
 GROUP BY COALESCE(organization_id, 0), LEFT(TRIM(customer_name), 100);
