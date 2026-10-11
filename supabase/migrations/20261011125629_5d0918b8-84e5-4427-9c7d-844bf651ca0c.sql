-- Fakturalesing: varige lesevarsler, rettelser og læringseksempler (del 1: struktur og kontroll)

alter table public.invoices add column if not exists extraction_issues jsonb not null default '[]'::jsonb;
alter table public.invoice_lines add column if not exists extraction_issues jsonb not null default '[]'::jsonb;

create or replace function public.rm_read_unit_factor(p_from text, p_to text)
returns numeric language sql immutable set search_path = public as $$
  select case
    when lower(coalesce(p_from,'')) = '' or lower(coalesce(p_to,'')) = '' then null
    when lower(p_from) = lower(p_to) then 1::numeric
    when lower(p_from) = 'g'  and lower(p_to) = 'kg' then 0.001
    when lower(p_from) = 'kg' and lower(p_to) = 'g'  then 1000
    when lower(p_from) = 'ml' and lower(p_to) = 'l'  then 0.001
    when lower(p_from) = 'cl' and lower(p_to) = 'l'  then 0.01
    when lower(p_from) = 'dl' and lower(p_to) = 'l'  then 0.1
    when lower(p_from) = 'l'  and lower(p_to) = 'ml' then 1000
    else null end
$$;

create or replace function public.rm_line_read_issues(
  p_quantity numeric, p_unit text, p_unit_price numeric, p_total numeric,
  p_package_size numeric, p_package_unit text, p_count_per_package numeric, p_is_credit boolean default false)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_tol numeric; v_pkg numeric; v_f numeric; v_base text; v_plain numeric;
  v_cands numeric[] := array[]::numeric[]; c numeric;
begin
  if p_total is null then
    return jsonb_build_array(jsonb_build_object('code','linjesum_mangler','message','Linjesummen mangler. Les den av originalen.'));
  end if;
  if not public.rm_is_finite(p_total)
     or (p_quantity is not null and not public.rm_is_finite(p_quantity))
     or (p_unit_price is not null and not public.rm_is_finite(p_unit_price)) then
    return jsonb_build_array(jsonb_build_object('code','ugyldig_tall','message','Et tall på linjen er ikke gyldig.'));
  end if;
  if p_quantity is null or p_unit_price is null then
    return '[]'::jsonb;
  end if;
  if p_quantity = 0 and p_total <> 0 then
    return jsonb_build_array(jsonb_build_object('code','mengde_null','message','Mengden er 0, men linjen har et beløp.'));
  end if;
  v_tol := greatest(0.02, 0.015 * abs(p_total));
  v_plain := p_quantity * p_unit_price;
  v_cands := array_append(v_cands, v_plain);
  v_pkg := case when public.rm_is_finite(p_package_size) and p_package_size > 0
                then p_package_size * coalesce(nullif(p_count_per_package, 0), 1) end;
  if v_pkg is not null then
    v_cands := array_append(v_cands, p_quantity * v_pkg * p_unit_price);
    v_base := case lower(coalesce(p_package_unit,'')) when 'g' then 'kg' when 'ml' then 'l' when 'cl' then 'l' when 'dl' then 'l' else null end;
    v_f := public.rm_read_unit_factor(p_package_unit, v_base);
    if v_f is not null then v_cands := array_append(v_cands, p_quantity * v_pkg * v_f * p_unit_price); end if;
    v_f := public.rm_read_unit_factor(p_package_unit, p_unit);
    if v_f is not null and v_f > 0 and lower(coalesce(p_unit,'')) in ('g','kg','ml','cl','dl','l') then
      v_cands := array_append(v_cands, p_quantity / (v_pkg * v_f) * p_unit_price);
    end if;
  end if;
  foreach c in array v_cands loop
    if abs(abs(c) - abs(p_total)) <= v_tol then return '[]'::jsonb; end if;
  end loop;
  if abs(p_total) < abs(v_plain) and abs(p_total) >= 0.5 * abs(v_plain) then
    return jsonb_build_array(jsonb_build_object('code','mulig_rabatt',
      'message', format('Linjesummen %s er lavere enn mengde × pris (%s). Kontroller rabatt mot originalen.', round(p_total, 2), round(v_plain, 2))));
  end if;
  return jsonb_build_array(jsonb_build_object('code','regnestykke',
    'message', format('Mengde × pris (%s) stemmer ikke med linjesummen (%s).', round(v_plain, 2), round(p_total, 2))));
end $$;

create or replace function public.rm_lines_sum_check(p_sum numeric, p_count int, p_total numeric, p_vat numeric)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_exp numeric; v_tol numeric; v_var numeric; v_sum numeric;
begin
  if coalesce(p_count, 0) = 0 then
    return jsonb_build_object('lines_sum_excl_vat', null, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_lines');
  end if;
  v_sum := round(coalesce(p_sum, 0), 2);
  if p_total is null or not public.rm_is_finite(p_total) or p_total = 0 then
    return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_total');
  end if;
  if p_vat is not null and public.rm_is_finite(p_vat) then v_exp := p_total - p_vat; v_tol := 2; else v_exp := p_total; v_tol := 20; end if;
  if v_exp = 0 then
    return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_total');
  end if;
  v_var := round((v_sum - v_exp) / v_exp * 100, 3);
  return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', v_var,
    'lines_sum_status', case when abs(v_var) <= v_tol then 'ok' else 'mismatch' end);
end $$;

create or replace function public.rm_invoice_has_read_issues(p_invoice_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invoices i where i.id = p_invoice_id and jsonb_array_length(coalesce(i.extraction_issues,'[]'::jsonb)) > 0)
      or exists (select 1 from public.invoice_lines il where il.invoice_id = p_invoice_id
                  and coalesce(il.match_confidence::text,'') <> 'not_applicable'
                  and jsonb_array_length(coalesce(il.extraction_issues,'[]'::jsonb)) > 0)
$$;
revoke execute on function public.rm_invoice_has_read_issues(uuid) from public, anon;

create or replace function public.trg_invoice_lines_read_issues()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_credit boolean;
begin
  if tg_op = 'INSERT' then
    if jsonb_array_length(coalesce(new.extraction_issues,'[]'::jsonb)) = 0 then
      select coalesce(is_credit_note,false) into v_credit from public.invoices where id = new.invoice_id;
      new.extraction_issues := public.rm_line_read_issues(new.quantity, new.unit, new.unit_price, new.total_amount,
        new.package_size, new.package_unit, new.count_per_package, coalesce(v_credit,false));
    end if;
  elsif new.extraction_issues is distinct from old.extraction_issues
        and coalesce(current_setting('rm.read_issue_write', true), '') <> 'on'
        and auth.uid() is not null then
    new.extraction_issues := old.extraction_issues;
  end if;
  new.extraction_issues := coalesce(new.extraction_issues, '[]'::jsonb);
  if jsonb_array_length(new.extraction_issues) > 0 and coalesce(new.match_confidence::text,'') <> 'not_applicable' then
    new.requires_review := true;
    if coalesce(new.review_reason,'') !~ 'extraction_issue' then
      new.review_reason := concat_ws(',', nullif(new.review_reason,''), 'extraction_issue');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_invoice_lines_read_issues on public.invoice_lines;
create trigger trg_invoice_lines_read_issues before insert or update on public.invoice_lines
  for each row execute function public.trg_invoice_lines_read_issues();

create or replace function public.trg_invoices_read_issues()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_exp numeric; v_ratio numeric; r numeric; v_hit numeric;
begin
  if new.extraction_issues is distinct from old.extraction_issues
     and coalesce(current_setting('rm.read_issue_write', true), '') <> 'on'
     and auth.uid() is not null then
    new.extraction_issues := old.extraction_issues;
  end if;
  new.extraction_issues := coalesce(new.extraction_issues, '[]'::jsonb);
  if new.lines_sum_status is distinct from old.lines_sum_status or new.lines_sum_excl_vat is distinct from old.lines_sum_excl_vat then
    new.extraction_issues := coalesce((select jsonb_agg(e) from jsonb_array_elements(new.extraction_issues) e
                                       where e->>'code' <> 'sumavvik_mva_forhold'), '[]'::jsonb);
    if new.lines_sum_status = 'mismatch' and public.rm_is_finite(new.lines_sum_excl_vat) and public.rm_is_finite(new.total_amount) then
      v_exp := new.total_amount - coalesce(new.total_vat, 0);
      if v_exp <> 0 then
        v_ratio := new.lines_sum_excl_vat / v_exp;
        foreach r in array array[1.25, 1.15, 1.12, 1/1.25, 1/1.15, 1/1.12]::numeric[] loop
          if abs(v_ratio - r) <= 0.005 then v_hit := r; exit; end if;
        end loop;
        if v_hit is not null then
          new.extraction_issues := new.extraction_issues || jsonb_build_array(jsonb_build_object(
            'code', 'sumavvik_mva_forhold',
            'message', format('Linjesummen avviker fra fakturabeløpet eks. mva med forholdet %s, det samme som en mva-sats. Det kan være en mva-feil, men også en manglende linje. Ingen beløp er endret – kontroller mot originalen.', round(v_ratio, 4))));
        end if;
      end if;
    end if;
  end if;
  if new.status = 'ready' and (jsonb_array_length(new.extraction_issues) > 0
      or exists (select 1 from public.invoice_lines il where il.invoice_id = new.id
                  and coalesce(il.match_confidence::text,'') <> 'not_applicable'
                  and jsonb_array_length(coalesce(il.extraction_issues,'[]'::jsonb)) > 0)) then
    new.status := 'needs_review';
  end if;
  return new;
end $$;

drop trigger if exists trg_invoices_read_issues on public.invoices;
create trigger trg_invoices_read_issues before update on public.invoices
  for each row execute function public.trg_invoices_read_issues();

create table public.invoice_line_corrections (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  invoice_line_id uuid references public.invoice_lines(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  original jsonb not null,
  corrected jsonb not null,
  changed_fields text[] not null default '{}',
  reason text not null,
  accepted_issues jsonb not null default '[]'::jsonb,
  learn boolean not null default false,
  example_id uuid,
  corrected_by uuid not null,
  corrected_at timestamptz not null default now()
);
grant select on public.invoice_line_corrections to authenticated;
grant all on public.invoice_line_corrections to service_role;
alter table public.invoice_line_corrections enable row level security;
create policy "Les fakturarettelser" on public.invoice_line_corrections for select to authenticated
  using (public.has_ravarer_invoice_access(legal_entity_id, 'read'));
create index invoice_line_corrections_line_idx on public.invoice_line_corrections (invoice_line_id, corrected_at desc);
create index invoice_line_corrections_invoice_idx on public.invoice_line_corrections (invoice_id);

create table public.invoice_extraction_examples (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  supplier_sku_norm text,
  description_key text,
  original jsonb not null,
  corrected jsonb not null,
  note text,
  source_correction_id uuid references public.invoice_line_corrections(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  deactivated_by uuid
);
grant select on public.invoice_extraction_examples to authenticated;
grant all on public.invoice_extraction_examples to service_role;
alter table public.invoice_extraction_examples enable row level security;
create policy "Les læringseksempler" on public.invoice_extraction_examples for select to authenticated
  using (public.has_ravarer_invoice_access(legal_entity_id, 'read'));
create index invoice_extraction_examples_supplier_idx on public.invoice_extraction_examples (legal_entity_id, supplier_id) where is_active;

create table public.supplier_case_email_drafts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.supplier_deviation_cases(id) on delete cascade,
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  version int not null,
  subject text not null,
  body text not null,
  missing_basis boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (case_id, version)
);
grant select on public.supplier_case_email_drafts to authenticated;
grant all on public.supplier_case_email_drafts to service_role;
alter table public.supplier_case_email_drafts enable row level security;
create policy "Les e-postkladder for leverandørsaker" on public.supplier_case_email_drafts for select to authenticated
  using (public.has_ravarer_invoice_access(legal_entity_id, 'read'));

create unique index if not exists email_outbox_supplier_case_draft_uniq on public.email_outbox (related_entity_id)
  where related_entity_type = 'supplier_case_email_draft';
