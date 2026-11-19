alter table public.invoice_reading_settings
  add column if not exists ehf_first boolean not null default false;

comment on column public.invoice_reading_settings.ehf_first is
  'EHF først: Tripletex-import bruker komplette EHF-linjer framfor AI-lesing av PDF. Standard av.';