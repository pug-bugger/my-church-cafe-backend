-- Create Database
CREATE DATABASE IF NOT EXISTS church_cafe CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE church_cafe;

-- Roles Table
CREATE TABLE IF NOT EXISTS roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255)
);

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    picture_url VARCHAR(512) NULL,
    role_id INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
);

-- Categories Table
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    parent_id INT NULL,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Products Table
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    base_price DECIMAL(10,2),
    image_url VARCHAR(255),
    available BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Legacy per-product flat options (older API; new flows use drink_option_* tables below)
CREATE TABLE IF NOT EXISTS product_options (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT,
    name VARCHAR(50) NOT NULL,
    value VARCHAR(50) NOT NULL,
    extra_price DECIMAL(10,2) DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Reusable drink option definitions (admin creates first, then assigns to products)
CREATE TABLE IF NOT EXISTS drink_option_definitions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    option_key VARCHAR(64) NOT NULL UNIQUE,
    type ENUM('checkbox', 'select') NOT NULL DEFAULT 'select',
    checkbox_extra_price DECIMAL(10,2) DEFAULT 0,
    sort_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Picklist / radio choices for select-type options
CREATE TABLE IF NOT EXISTS drink_option_values (
    id INT AUTO_INCREMENT PRIMARY KEY,
    option_definition_id INT NOT NULL,
    label VARCHAR(100) NOT NULL,
    extra_price DECIMAL(10,2) DEFAULT 0,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (option_definition_id) REFERENCES drink_option_definitions(id) ON DELETE CASCADE
);

-- Which products use which reusable options (order follows sort_order)
CREATE TABLE IF NOT EXISTS product_drink_options (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    option_definition_id INT NOT NULL,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (option_definition_id) REFERENCES drink_option_definitions(id) ON DELETE CASCADE,
    UNIQUE KEY uq_product_drink_option (product_id, option_definition_id)
);

-- Product Items Table
CREATE TABLE IF NOT EXISTS product_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT,
    name VARCHAR(100) NOT NULL,
    sku VARCHAR(50),
    price DECIMAL(10,2),
    available BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    total DECIMAL(10,2),
    status ENUM('pending', 'preparing', 'ready', 'paid', 'cancelled', 'completed') DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT,
    product_id INT,
    quantity INT DEFAULT 1,
    price DECIMAL(10,2),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- Selected drink options at order time (for barista / receipts)
CREATE TABLE IF NOT EXISTS order_item_options (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_item_id INT NOT NULL,
    drink_option_definition_id INT NULL,
    option_definition_name VARCHAR(100) NOT NULL,
    option_value_name VARCHAR(100) NOT NULL,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
    FOREIGN KEY (drink_option_definition_id) REFERENCES drink_option_definitions(id) ON DELETE SET NULL
);

-- Insert Default Roles
INSERT INTO roles (name, description) VALUES
('admin', 'Full access'),
('personal', 'Cafe staff'),
('parishioner', 'Regular customer')
ON DUPLICATE KEY UPDATE description = VALUES(description);


