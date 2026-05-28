-- Drink subtypes (child categories under Drink)
-- Products use products.category_id → subtype row (e.g. Coffee), not the parent Drink row.

INSERT INTO categories (name, parent_id)
SELECT 'Drink', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = 'drink' AND parent_id IS NULL
);

INSERT INTO categories (name, parent_id)
SELECT 'Coffee', p.id
FROM categories p
WHERE LOWER(TRIM(p.name)) = 'drink' AND p.parent_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = 'coffee')
LIMIT 1;

INSERT INTO categories (name, parent_id)
SELECT 'Other drinks', p.id
FROM categories p
WHERE LOWER(TRIM(p.name)) = 'drink' AND p.parent_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = 'other drinks')
LIMIT 1;

INSERT INTO categories (name, parent_id)
SELECT 'Season drinks', p.id
FROM categories p
WHERE LOWER(TRIM(p.name)) = 'drink' AND p.parent_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = 'season drinks')
LIMIT 1;
