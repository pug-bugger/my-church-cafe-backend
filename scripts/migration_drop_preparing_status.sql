-- The barista queue no longer has a "preparing" step: an order stays 'pending'
-- until someone marks it ready. Rehome any row left mid-flight when that
-- shipped. Idempotent — a no-op once no 'preparing' rows remain.
--
-- Run this at the same time the new clients go out, not before. The queue also
-- shows 'preparing' orders as a safety net, so nothing is stranded either way.
--
-- 'preparing' deliberately STAYS in the orders.status ENUM: MODIFY COLUMN is
-- refused while rows still hold the value, historical orders keep it, and
-- nothing is gained by removing it.

UPDATE orders SET status = 'pending' WHERE status = 'preparing';
