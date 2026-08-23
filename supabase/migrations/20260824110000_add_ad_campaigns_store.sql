alter table ad_campaigns
  add column if not exists platform_account_id uuid references platform_accounts(id);
