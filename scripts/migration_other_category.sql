-- Top-level "Other" product category, plus "Meal" — which PRODUCT_CATEGORY has
-- listed in both clients since the start but no migration ever seeded, so
-- creating a meal failed on a category lookup that could never succeed.
--
-- Guard matches migration_drink_subtypes.sql: LOWER(TRIM(name)) AND
-- parent_id IS NULL. The parent_id clause is what keeps this honest — "Other
-- drinks" already exists as a child of Drink, and only a top-level row counts
-- as the category being seeded here. Idempotent: safe to re-run.

INSERT INTO categories (name, parent_id)
SELECT 'Meal', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = 'meal' AND parent_id IS NULL
);

INSERT INTO categories (name, parent_id)
SELECT 'Other', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = 'other' AND parent_id IS NULL
);
