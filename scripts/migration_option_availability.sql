-- "Sold out until tomorrow" for drink options.
--
-- Staff can mark one choice of a picklist ("Oat milk") or a whole checkbox
-- option ("Whipped cream") as unavailable until midnight, from the terminal.
-- Options are shared between products, so this is set once on the option and
-- reaches every drink that offers it.
--
-- `unavailable_until` is the moment it comes back: NULL, or a time already
-- past, means available. Nothing has to clear it — the reads compare it with
-- NOW() — so there is no restore job.
--
-- Run once. Not idempotent (plain ALTER TABLE).

ALTER TABLE drink_option_values
    ADD COLUMN unavailable_until DATETIME NULL DEFAULT NULL;

ALTER TABLE drink_option_definitions
    ADD COLUMN unavailable_until DATETIME NULL DEFAULT NULL;
