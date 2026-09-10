-- Add platform sync fields for TikTok/Shopee product import
-- Enables upsert-based product sync from external platforms

ALTER TABLE products
ADD COLUMN platform TEXT,
ADD COLUMN platform_sync_id TEXT;

-- Unique constraint on platform_sync_id for ON CONFLICT upsert support
ALTER TABLE products
ADD CONSTRAINT products_platform_sync_id_key UNIQUE (platform_sync_id);

-- Index for filtering by platform
CREATE INDEX idx_products_platform ON products(platform);
