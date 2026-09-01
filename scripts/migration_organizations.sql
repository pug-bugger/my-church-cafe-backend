-- Adds multi-tenant organization support.
-- Existing users/orders are backfilled into a single "Default" organization
-- so existing installs keep working after this migration.

CREATE TABLE IF NOT EXISTS organizations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO organizations (name)
SELECT 'Default' WHERE NOT EXISTS (
  SELECT 1 FROM organizations WHERE name = 'Default'
);

ALTER TABLE users
    ADD COLUMN organization_id INT NULL AFTER role_id,
    ADD CONSTRAINT fk_users_organization FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE orders
    ADD COLUMN organization_id INT NULL AFTER user_id,
    ADD CONSTRAINT fk_orders_organization FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE users SET organization_id = (SELECT id FROM organizations WHERE name = 'Default')
WHERE organization_id IS NULL;

UPDATE orders SET organization_id = (SELECT id FROM organizations WHERE name = 'Default')
WHERE organization_id IS NULL;
