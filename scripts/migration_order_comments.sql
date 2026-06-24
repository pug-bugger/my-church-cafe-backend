-- Add comment columns for order-level and per-item notes
ALTER TABLE orders ADD COLUMN comment TEXT NULL;
ALTER TABLE order_items ADD COLUMN comment TEXT NULL;
