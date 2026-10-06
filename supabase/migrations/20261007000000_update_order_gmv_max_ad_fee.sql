-- Update order settlement GMV Max Ad Fee for order 586446439220413512
-- 2026-10-07: Set tiktok_gmv_max_ad_fee to 0.85
UPDATE order_settlements
SET tiktok_gmv_max_ad_fee = 0.85,
    updated_at = NOW()
WHERE order_id IN (
  SELECT id FROM orders
  WHERE order_no = '586446439220413512'
);

-- Verify the update
SELECT o.order_no, os.tiktok_gmv_max_ad_fee, os.updated_at
FROM order_settlements os
JOIN orders o ON o.id = os.order_id
WHERE o.order_no = '586446439220413512';
