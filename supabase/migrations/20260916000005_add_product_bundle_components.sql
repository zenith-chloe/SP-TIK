-- Product Bundle/Kit support: map platform SKU to multiple AutoCount SKUs
-- Example: Platform SKU "SET-001" = A001x1 + B001x1 + C001x1
-- No changes to existing products/orders/order_items

CREATE TABLE IF NOT EXISTS product_bundle_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_sku text NOT NULL,
  component_sku text NOT NULL,
  qty int NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(bundle_sku, component_sku),
  CHECK (qty > 0)
);

-- Index for fast bundle lookup
CREATE INDEX IF NOT EXISTS idx_product_bundle_components_bundle_sku ON product_bundle_components(bundle_sku);
