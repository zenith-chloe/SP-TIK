-- Add tiktok_gmv_max_ad_fee column to orders table
-- 2026-10-08: Store estimated GMV Max ad fee from TikTok Order Search API
-- This is the ESTIMATED fee (available immediately after order creation)
-- NOT the settlement fee (available after TikTok settlement completion)

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS tiktok_gmv_max_ad_fee NUMERIC DEFAULT NULL;

-- Verify the column was created
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'tiktok_gmv_max_ad_fee';
