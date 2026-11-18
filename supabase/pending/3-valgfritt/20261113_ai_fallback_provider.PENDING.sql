-- VENTER PÅ ROOT – KJØRES IKKE AV AGENTEN.
-- Rettepakke fakturalesing 13.11.2026, punkt C (reserveleverandør).
-- Kontroll: 20261113_ai_fallback_provider.check.sql (bare SELECT).
--
-- Ny kolonne ai_provider_config.use_as_fallback. extract-invoice-from-pdf bruker en INAKTIV rad med
-- use_as_fallback=true for samme formål bare når hovedleverandøren feiler på tjenesten (avvist nøkkel,
-- kvote, nede, nettverk, oppsett) eller ingen aktiv rad finnes. Uten kolonnen (før denne filen) feiler
-- oppslaget og koden bruker ingen reserve – som før.
-- Filen endrer INGEN rader: ingen nøkler, ingen aktivering. Den inaktive anthropic-raden for
-- invoice_extraction blir først reserve når Henrik/root eksplisitt kjører linjen nederst (kommentert ut),
-- og bare etter at nøkkelen i raden er kontrollert med «Test tilkobling».

begin;

alter table public.ai_provider_config
  add column if not exists use_as_fallback boolean not null default false;

-- En aktiv rad er aldri samtidig reserve.
alter table public.ai_provider_config
  drop constraint if exists ai_provider_config_fallback_inactive;
alter table public.ai_provider_config
  add constraint ai_provider_config_fallback_inactive check (not (use_as_fallback and is_active));

-- Høyst én reserve per formål.
create unique index if not exists ai_provider_config_fallback_purpose_idx
  on public.ai_provider_config (purpose) where (use_as_fallback = true);

comment on column public.ai_provider_config.use_as_fallback is
  'Inaktiv rad som brukes automatisk når den aktive leverandøren for samme formål feiler på tjenesten (nøkkel/kvote/nede). Brukes i dag bare av fakturalesingen.';

commit;

-- VALGFRITT, IKKE DEL AV GJENNOMGANGEN – kjøres bare eksplisitt av Henrik/root etter at nøkkelen er testet:
-- update public.ai_provider_config set use_as_fallback = true
--  where purpose = 'invoice_extraction' and provider = 'anthropic' and is_active = false;
