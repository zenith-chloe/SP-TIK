-- Verify order counts match TikTok Shop API
-- Platform data: Awaiting shipment = 36, In transit = 60, Delivered = 426

SELECT
  'Platform Awaiting Shipment (36)' as metric,
  COUNT(*) as erp_count
FROM orders
WHERE platform = 'tiktok'
  AND platform_status = 'AWAITING_SHIPMENT'
  AND NOT (delivery_option IN ('Instant', 'Instant Delivery', 'Same-Day Delivery', 'Next-Day Delivery'));

SELECT
  'Instant Orders (Awaiting Shipment)' as metric,
  COUNT(*) as instant_count
FROM orders
WHERE platform = 'tiktok'
  AND platform_status = 'AWAITING_SHIPMENT'
  AND delivery_option IN ('Instant', 'Instant Delivery', 'Same-Day Delivery', 'Next-Day Delivery');

SELECT
  'Platform In Transit (60)' as metric,
  COUNT(*) as erp_count
FROM orders
WHERE platform = 'tiktok'
  AND platform_status IN ('IN_TRANSIT', 'SHIPPED');

SELECT
  'Platform Delivered (426)' as metric,
  COUNT(*) as erp_count
FROM orders
WHERE platform = 'tiktok'
  AND platform_status = 'DELIVERED';

SELECT
  'Platform Completed' as metric,
  COUNT(*) as erp_count
FROM orders
WHERE platform = 'tiktok'
  AND platform_status = 'COMPLETED';

-- Status breakdown
SELECT
  'All TikTok Orders' as metric,
  COUNT(*) as total,
  JSON_OBJECT_AGG(platform_status, status_count)::text as by_status
FROM (
  SELECT platform_status, COUNT(*) as status_count
  FROM orders
  WHERE platform = 'tiktok'
  GROUP BY platform_status
) t;

-- Fulfillment status after sync
SELECT
  'Fulfillment Status Distribution' as metric,
  fulfillment_status,
  COUNT(*) as count
FROM orders
WHERE platform = 'tiktok'
GROUP BY fulfillment_status
ORDER BY count DESC;
