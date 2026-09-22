-- Run once. Snapshots the surcharge each selected option actually cost onto the
-- order line, so that editing an option's price later never rewrites the totals
-- of orders already placed.
--
-- Until this, drink_option_values.extra_price and
-- drink_option_definitions.checkbox_extra_price were stored and displayed but
-- never added to any total — order totals came from products.base_price alone.

ALTER TABLE order_item_options
  ADD COLUMN extra_price DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER option_value_name;

-- OPTIONAL HARDENING — run only if the query below returns no rows.
--
-- A select-style option is priced by matching the stored label back to its
-- drink_option_values row, because the client sends labels rather than value
-- ids. Two values sharing a label inside one definition would therefore be
-- ambiguous. The server picks the lowest id in that case, but the constraint
-- removes the ambiguity at the source.
--
--   SELECT option_definition_id, label, COUNT(*) AS n
--     FROM drink_option_values
--    GROUP BY option_definition_id, label
--   HAVING n > 1;
--
-- ALTER TABLE drink_option_values
--   ADD UNIQUE KEY uq_option_value_label (option_definition_id, label);
