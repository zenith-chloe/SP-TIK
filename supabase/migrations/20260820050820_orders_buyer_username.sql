-- Real Shopee buyer_username (order/get_order_detail optional field) —
-- 2026-08-20: buyer_user_id (numeric) turned out NOT to work as a
-- ?buyer_id= URL query param on Shopee's real webchat page (confirmed live
-- by the user), so the button switches to a copy-to-clipboard workflow
-- instead, which needs the buyer's actual account handle (a string, e.g.
-- "noranissa88"), not the numeric id. Nullable/additive only.
alter table public.orders add column if not exists buyer_username text;
