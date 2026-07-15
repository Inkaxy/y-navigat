
ALTER TABLE public.customer_portal_accounts DROP CONSTRAINT IF EXISTS customer_portal_accounts_user_id_unique;
ALTER TABLE public.customer_portal_accounts
  ADD CONSTRAINT customer_portal_accounts_user_customer_unique UNIQUE (user_id, customer_id);
