-- Add Shopee partner authentication fields to platform_accounts
-- Required for Shopee Open Platform v2 API authentication

ALTER TABLE platform_accounts
ADD COLUMN partner_id TEXT,
ADD COLUMN partner_key TEXT;

-- Create index for Shopee partner lookups
CREATE INDEX idx_platform_accounts_partner_id ON platform_accounts(partner_id) WHERE partner_id IS NOT NULL;
