-- KONTROLL – bare SELECT, skriver ingenting. Hører til 20261113_ai_fallback_provider.PENDING.sql.
-- Leser aldri nøklene.

-- 1) Finnes kolonnen? (false før, true etter)
select exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'ai_provider_config' and column_name = 'use_as_fallback') as har_kolonne;

-- 2) Rader for fakturalesing uten nøkkel (etter kjøring: use_as_fallback=false på alle til den valgfrie linjen kjøres).
select id, provider, model, is_active, max_tokens, updated_at
  from public.ai_provider_config where purpose = 'invoice_extraction' order by is_active desc, provider;
