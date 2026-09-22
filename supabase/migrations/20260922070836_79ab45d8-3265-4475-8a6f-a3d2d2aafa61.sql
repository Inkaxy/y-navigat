alter table public.invoice_match_settings
  add column if not exists auto_check_against_last_purchase boolean not null default false;

comment on column public.invoice_match_settings.auto_check_against_last_purchase is
  'Når sann kan motoren ferdigkontrollere en automatisk koblet linje mot forrige registrerte kjøpspris (last_purchase) så lenge avviket er innenfor toleransen. Avvik går fortsatt til gjennomgang.';

update public.invoice_match_settings
   set auto_check_against_last_purchase = true,
       updated_at = now()
 where auto_check_against_last_purchase = false;