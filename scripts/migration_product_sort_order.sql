-- Hand-picked product order for the terminal and the menu board.
--
-- Products used to come back in `name ASC`, so the cafe could not put the
-- drinks it actually sells at the top of the picker. `sort_order` is a single
-- running sequence over every product; the clients group by category on top of
-- it, so a group's internal order is whatever this column says.
--
-- The seeding UPDATE numbers the existing rows in the alphabetical order they
-- already displayed in, so the first reorder starts from what staff see today
-- rather than from an arbitrary insert order.
--
-- Run once. Not idempotent (plain ALTER TABLE).

ALTER TABLE products
    ADD COLUMN sort_order INT NOT NULL DEFAULT 0;

SET @row := 0;
UPDATE products SET sort_order = (@row := @row + 1) ORDER BY name ASC;
