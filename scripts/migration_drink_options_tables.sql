-- Run against your cafe database (same DB as DB_NAME in .env).
-- Safe to run once; uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS drink_option_definitions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    option_key VARCHAR(64) NOT NULL UNIQUE,
    type ENUM('checkbox', 'select') NOT NULL DEFAULT 'select',
    checkbox_extra_price DECIMAL(10,2) DEFAULT 0,
    sort_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drink_option_values (
    id INT AUTO_INCREMENT PRIMARY KEY,
    option_definition_id INT NOT NULL,
    label VARCHAR(100) NOT NULL,
    extra_price DECIMAL(10,2) DEFAULT 0,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (option_definition_id) REFERENCES drink_option_definitions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_drink_options (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    option_definition_id INT NOT NULL,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (option_definition_id) REFERENCES drink_option_definitions(id) ON DELETE CASCADE,
    UNIQUE KEY uq_product_drink_option (product_id, option_definition_id)
);
