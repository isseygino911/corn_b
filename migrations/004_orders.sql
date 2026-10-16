CREATE TABLE settings (
  setting_key VARCHAR(40) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- country_code NULL is the default row. country_key ('--' for that row, else the country code) is set by the
-- service so UNIQUE also allows only one default row (NULLs never collide). A plain column, not a generated
-- one, because MariaDB refuses generated columns here.
CREATE TABLE shipping_rates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  country_code CHAR(2) NULL,
  country_key CHAR(2) NOT NULL DEFAULT '--' UNIQUE,
  price_cents INT UNSIGNED NOT NULL,
  active BOOL NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- order_number is set right after insert, from the row id (GGF-000123).
CREATE TABLE orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL UNIQUE,
  order_number VARCHAR(20) NULL UNIQUE,
  user_id INT UNSIGNED NOT NULL,
  email VARCHAR(255) NOT NULL,
  status ENUM('placed', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'placed',
  full_name VARCHAR(80) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  line1 VARCHAR(120) NOT NULL,
  line2 VARCHAR(120) NULL,
  country_code CHAR(2) NOT NULL,
  state_code VARCHAR(10) NOT NULL,
  city VARCHAR(80) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  subtotal_cents INT UNSIGNED NOT NULL,
  shipping_cents INT UNSIGNED NOT NULL,
  tax_rate_bps INT UNSIGNED NOT NULL,
  tax_cents INT UNSIGNED NOT NULL,
  total_cents INT UNSIGNED NOT NULL,
  placed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_id, id),
  INDEX (status, id),
  FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NULL,
  sku VARCHAR(12) NOT NULL,
  name VARCHAR(120) NOT NULL,
  unit_cents INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  image_key VARCHAR(255) NULL,
  line_cents INT UNSIGNED NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_item_accessories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_item_id INT UNSIGNED NOT NULL,
  accessory_id INT UNSIGNED NULL,
  sku VARCHAR(12) NOT NULL,
  name VARCHAR(120) NOT NULL,
  unit_cents INT UNSIGNED NOT NULL,
  FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE CASCADE,
  FOREIGN KEY (accessory_id) REFERENCES accessories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
