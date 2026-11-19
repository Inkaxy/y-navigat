-- 02 EHF først (19.11.2026). Legger til bryteren invoice_reading_settings.ehf_first (standard AV).
-- Endrer ingen data: ingen fakturaer, linjer, varer eller priser røres. Bryteren virker først når
-- serverpatchen supabase/pending/functions/patches/20261119_ehf_forst.patch er rullet ut etter Henriks ja.
-- Når den er på: Tripletex-importen bruker EHF-linjene når EHF finnes og summene stemmer; ellers PDF-lesing som før.
-- Kontroll: kontroll/20261126_ehf_forst.check.sql
begin;

alter table public.invoice_reading_settings
  add column if not exists ehf_first boolean not null default false;

comment on column public.invoice_reading_settings.ehf_first is
  'EHF først: Tripletex-import bruker komplette EHF-linjer framfor AI-lesing av PDF. Standard av.';

commit;

-- SLÅ PÅ (egen kjøring, etter at serverpatchen er ute). Fjern «--» og kjør:
-- insert into public.invoice_reading_settings (legal_entity_id, ehf_first)
-- select id, true from public.legal_entities
-- on conflict (legal_entity_id) do update set ehf_first = true, updated_at = now();
