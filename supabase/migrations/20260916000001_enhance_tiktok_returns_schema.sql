-- Enhance tiktok_returns table with detailed return/refund tracking
-- Adds fields for return reason, refund amount, buyer/seller comments
-- Supports incremental sync via update_time

-- Add detailed return fields (if not already present, use ALTER TABLE ADD COLUMN IF NOT EXISTS)
ALTER TABLE public.tiktok_returns
ADD COLUMN IF NOT EXISTS return_reason TEXT,
ADD COLUMN IF NOT EXISTS refund_amount NUMERIC,
ADD COLUMN IF NOT EXISTS refund_currency TEXT,
ADD COLUMN IF NOT EXISTS order_amount NUMERIC,
ADD COLUMN IF NOT EXISTS buyer_comment TEXT,
ADD COLUMN IF NOT EXISTS seller_comment TEXT,
ADD COLUMN IF NOT EXISTS return_tracking_no TEXT,
ADD COLUMN IF NOT EXISTS return_deadline TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS refund_deadline TIMESTAMPTZ;

-- Create index for incremental sync (update_time DESC)
CREATE INDEX IF NOT EXISTS idx_tiktok_returns_update_time
ON public.tiktok_returns(update_time DESC)
WHERE update_time IS NOT NULL;

-- Create index for quick filtering by return_status
CREATE INDEX IF NOT EXISTS idx_tiktok_returns_status
ON public.tiktok_returns(return_status)
WHERE return_status IS NOT NULL;

-- Create index for linking returns to orders
CREATE INDEX IF NOT EXISTS idx_tiktok_returns_order_no
ON public.tiktok_returns(order_no);

-- Add comment for documentation
COMMENT ON TABLE public.tiktok_returns IS
'TikTok Shop Return & Refund data, synced separately from orders. Maps return_status to return lifecycle stages.';

COMMENT ON COLUMN public.tiktok_returns.return_status IS
'Return/Refund status: RETURN_REQUESTED, REFUND_ONLY, IN_RETURN, RETURN_RECEIVED, APPROVED, REFUND_PROCESSING, REFUND_COMPLETED, REJECTED, CANCELLED';

COMMENT ON COLUMN public.tiktok_returns.update_time IS
'Last update timestamp from TikTok, used for incremental sync filtering';
