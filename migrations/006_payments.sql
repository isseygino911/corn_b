-- Stripe hosted Checkout. An order waits in pending_payment until the webhook confirms payment; placed now means paid.
-- Tax comes from Stripe Tax, so the flat rate setting goes. tax_rate_bps stays only as history on older orders.
ALTER TABLE orders
  MODIFY status ENUM('pending_payment', 'placed', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending_payment',
  MODIFY tax_rate_bps INT UNSIGNED NULL,
  ADD stripe_session_id VARCHAR(255) NULL UNIQUE;

ALTER TABLE users ADD stripe_customer_id VARCHAR(255) NULL;

DELETE FROM settings WHERE setting_key = 'tax_rate_bps';
