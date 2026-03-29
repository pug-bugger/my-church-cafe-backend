-- Run once against your cafe database. Persists drink options per line item for barista display.

CREATE TABLE IF NOT EXISTS order_item_options (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_item_id INT NOT NULL,
    drink_option_definition_id INT NULL,
    option_definition_name VARCHAR(100) NOT NULL,
    option_value_name VARCHAR(100) NOT NULL,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
    FOREIGN KEY (drink_option_definition_id) REFERENCES drink_option_definitions(id) ON DELETE SET NULL
);
