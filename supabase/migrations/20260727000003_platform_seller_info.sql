-- Per-shop Seller (sender) info for shipping labels, so the Label Printing
-- module can auto-resolve the correct sender by the order's originating
-- platform_account instead of leaving Seller name/address/phone blank for
-- manual entry every print run. seller_name is separate from account_name
-- (the internal store nickname) since the printed sender should be the real
-- company/shipping name, not necessarily the same string.

alter table public.platform_accounts add column seller_name text;
alter table public.platform_accounts add column seller_address text;
alter table public.platform_accounts add column seller_phone text;
