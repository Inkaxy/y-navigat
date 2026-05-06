alter table public.invoices
  add column if not exists flagged_at timestamptz,
  add column if not exists flagged_by uuid,
  add column if not exists flag_reason text,
  add column if not exists flag_action_type text check (flag_action_type in ('internal_task','supplier_email','both'));