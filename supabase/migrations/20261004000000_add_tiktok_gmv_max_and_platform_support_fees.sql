-- Add missing TikTok settlement fee fields
-- 2026-10-04: Add tiktok_gmv_max_ad_fee and tiktok_platform_support_fee
-- These must be extracted from TikTok API statement_transactions and stored as real settlement data

ALTER TABLE order_settlements
ADD COLUMN IF NOT EXISTS tiktok_gmv_max_ad_fee NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS tiktok_platform_support_fee NUMERIC DEFAULT 0;

-- Add other potential missing fee fields for completeness
ALTER TABLE order_settlements
ADD COLUMN IF NOT EXISTS tiktok_voucher_xtra_discount NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS tiktok_bxp_amount NUMERIC DEFAULT 0;
