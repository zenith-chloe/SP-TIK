-- Real Shopee buyer_user_id (order/get_order_detail optional field), needed
-- to build a real buyer-specific Shopee Seller Center webchat deep link from
-- the order drawer's 即时聊天 button. Never present in the payload before
-- this — response_optional_fields didn't request it. Nullable/additive only,
-- no existing column/constraint touched; TikTok orders leave this null
-- (their own chat flow is unaffected/unrequested).
alter table public.orders add column if not exists buyer_user_id bigint;
