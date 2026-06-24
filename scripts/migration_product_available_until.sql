-- Adds available_until for temporary hide-until-midnight scheduling.
-- When available = 0 AND available_until IS NOT NULL AND available_until <= NOW(),
-- the backend auto-restores the product to available = 1 on the next GET.
ALTER TABLE products
  ADD COLUMN available_until DATETIME NULL DEFAULT NULL
  AFTER available;
