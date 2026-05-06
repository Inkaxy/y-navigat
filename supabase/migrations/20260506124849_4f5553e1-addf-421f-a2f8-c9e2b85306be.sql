create table public.ai_provider_config (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('anthropic','openai','azure_openai')),
  encrypted_api_key text not null,
  model text not null,
  max_tokens int not null default 2000,
  temperature numeric not null default 0.1,
  is_active boolean not null default true,
  purpose text not null,
  azure_endpoint text,
  azure_deployment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ai_provider_config_active_purpose_idx
  on public.ai_provider_config (purpose) where is_active = true;

alter table public.ai_provider_config enable row level security;

create policy "Platform admins can read AI config"
  on public.ai_provider_config for select using (public.is_platform_admin());
create policy "Platform admins can insert AI config"
  on public.ai_provider_config for insert with check (public.is_platform_admin());
create policy "Platform admins can update AI config"
  on public.ai_provider_config for update using (public.is_platform_admin());
create policy "Platform admins can delete AI config"
  on public.ai_provider_config for delete using (public.is_platform_admin());

create trigger ai_provider_config_set_updated_at
  before update on public.ai_provider_config
  for each row execute function public.set_updated_at();

create table public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  purpose text not null,
  input_tokens int,
  output_tokens int,
  estimated_cost_usd numeric,
  invoice_id uuid references public.invoices(id) on delete set null,
  legal_entity_id uuid references public.legal_entities(id) on delete set null,
  success boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);

create index ai_usage_log_created_at_idx on public.ai_usage_log (created_at desc);
create index ai_usage_log_purpose_idx on public.ai_usage_log (purpose, created_at desc);

alter table public.ai_usage_log enable row level security;

create policy "Platform admins can read AI usage log"
  on public.ai_usage_log for select using (public.is_platform_admin());