-- Dessert product category (products.category_id → categories.id)
-- Product type is stored as category name, not a separate product_type column.

INSERT INTO categories (name, parent_id)
SELECT 'Dessert', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM categories WHERE LOWER(name) = 'dessert'
);
