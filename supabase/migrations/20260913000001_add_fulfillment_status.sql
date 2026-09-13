-- Add fulfillment_status column for TikTok order granular delivery tracking
-- Maps: DELIVERED → "delivered", COMPLETED → "completed", CANCELLED (delivery_failed) → "delivery_failed"

ALTER TABLE orders
ADD COLUMN fulfillment_status TEXT;

-- Add index for fast filtering on delivered/completed orders
CREATE INDEX idx_orders_fulfillment_status ON orders(fulfillment_status)
WHERE fulfillment_status IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN orders.fulfillment_status IS
  'Granular delivery status for TikTok Shop orders: "delivered", "completed", "delivery_failed", or null for other statuses';
