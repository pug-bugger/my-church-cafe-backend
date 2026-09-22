-- Default answers for drink options.
--
-- A picklist ("Milk") can now mark one of its choices as the one a product
-- opens with; a checkbox ("Take away") can open ticked. Without these the
-- terminal always opened on the first choice / unticked, which meant a barista
-- re-picked the same answer on nearly every order.
--
-- Run once. Not idempotent (plain ALTER TABLE).

ALTER TABLE drink_option_values
    ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE drink_option_definitions
    ADD COLUMN checkbox_default TINYINT(1) NOT NULL DEFAULT 0;
