-- LIVE MIRROR — negotiation_item_preservation_reviewed
-- Applied by root to live on 2026-10-12 ~05:49 UTC after two independent reviews.
-- Mirror only: DO NOT run again, DO NOT copy into supabase/migrations.
-- Supersedes supabase/pending/20261012_negotiation_item_preservation.PENDING.sql (defective, never applied).
-- Changes from b845: authorized helper ACL and durable monotonic issuance marker.
-- Real two-session PostgreSQL verification remains unavailable.
begin;
alter table public.negotiations add column if not exists rfq_issued_at timestamptz;
-- Retain affirmative existing issuance evidence; unissued live statuses remain usable.
update public.negotiations n set rfq_issued_at = now()
 where n.rfq_issued_at is null and (
 n.status = 'invited'
 or exists(select 1 from public.negotiation_recipients r where r.negotiation_id=n.id and (r.invited_at is not null or r.password_set_at is not null))
 or exists(select 1 from public.negotiation_items i join public.negotiation_responses r on r.negotiation_item_id=i.id where i.negotiation_id=n.id)
 or exists(select 1 from public.negotiation_items i join public.negotiation_outcomes o on o.negotiation_item_id=i.id where i.negotiation_id=n.id));
-- Historical issuance with all affirmative evidence already removed cannot be reconstructed.
create or replace function public._negotiations_issued_monotonic() returns trigger
language plpgsql set search_path='public' as $$
begin
 if old.rfq_issued_at is not null and new.rfq_issued_at is distinct from old.rfq_issued_at then
  raise exception 'Utstedelseshistorikk kan ikke nullstilles' using errcode='55000';
 end if;
 return new;
end $$;
drop trigger if exists trg_negotiations_issued_monotonic on public.negotiations;
create trigger trg_negotiations_issued_monotonic before update of rfq_issued_at on public.negotiations
 for each row execute function public._negotiations_issued_monotonic();

-- A direct authorized recipient edit cannot erase the only retained issuance evidence.
create or replace function public._negotiation_recipient_latch_issued() returns trigger
language plpgsql security definer set search_path='public' as $$
begin
 if new.invited_at is not null or new.password_set_at is not null then
  update public.negotiations set rfq_issued_at=coalesce(rfq_issued_at,now()) where id=new.negotiation_id;
 end if;
 return new;
end $$;
revoke all on function public._negotiation_recipient_latch_issued() from public,anon,authenticated;
drop trigger if exists trg_negotiation_recipient_latch_issued on public.negotiation_recipients;
create trigger trg_negotiation_recipient_latch_issued after insert or update of invited_at,password_set_at,negotiation_id on public.negotiation_recipients
 for each row execute function public._negotiation_recipient_latch_issued();

-- Authorized pristine-draft predicate. Definer + fixed search_path
-- so RLS invisibility is never mistaken for "no evidence".
create or replace function public._negotiation_items_issued(p_negotiation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_le uuid; v_issued timestamptz;
begin
 select legal_entity_id,rfq_issued_at into v_le,v_issued from public.negotiations where id=p_negotiation_id;
 if v_le is null or public.has_negotiation_write(v_le) is not true then
  raise exception 'Not authorized' using errcode='42501';
 end if;
 return v_issued is not null
 or exists(select 1 from public.negotiation_recipients r where r.negotiation_id=p_negotiation_id and (r.invited_at is not null or r.password_set_at is not null))
 or exists(select 1 from public.negotiation_items i join public.negotiation_responses r on r.negotiation_item_id=i.id where i.negotiation_id=p_negotiation_id)
 or exists(select 1 from public.negotiation_items i join public.negotiation_outcomes o on o.negotiation_item_id=i.id where i.negotiation_id=p_negotiation_id);
end $$;
revoke all on function public._negotiation_items_issued(uuid) from public,anon,authenticated;
grant execute on function public._negotiation_items_issued(uuid) to authenticated,service_role;

-- (1) replace_child_rows — identical to live except the negotiation_items block.
create or replace function public.replace_child_rows(p_table text, p_parent_column text, p_parent_id uuid, p_rows jsonb default '[]'::jsonb)
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
DECLARE
  v_allowed CONSTANT text[] := ARRAY[
    'order_lines:order_id',
    'invoice_lines:invoice_id',
    'recurring_order_items:schedule_id',
    'recipe_lines:recipe_id',
    'recipe_lines:recipe_part_id',
    'recipe_labor_lines:recipe_id',
    'recipe_packaging_lines:recipe_id',
    'recipe_steps:recipe_id',
    'negotiation_items:negotiation_id',
    'negotiation_recipients:negotiation_id',
    'pos_terminal_printers:terminal_id',
    'pos_keypad_buttons:page_id',
    'pos_keypad_pages:layout_id',
    'customer_group_members:group_id',
    'customer_profile_price_lists:customer_profile_id',
    'cake_steps:cake_category_id',
    'product_package_items:package_product_id'
  ];
  v_key text := p_table || ':' || p_parent_column;
  v_cols text;
  v_sel text;
  v_count integer := 0;
  v_status text;
BEGIN
  IF NOT (v_key = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'replace_child_rows: ikke tillatt kombinasjon %', v_key
      USING ERRCODE = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'replace_child_rows: p_rows må være en jsonb-array';
  END IF;

  -- Negotiation items: only a pristine draft may be replaced (parent locked first).
  IF v_key = 'negotiation_items:negotiation_id' THEN
    SELECT n.status INTO v_status FROM public.negotiations n WHERE n.id = p_parent_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'replace_child_rows: forhandling finnes ikke' USING ERRCODE = 'P0002';
    END IF;
    IF v_status IS DISTINCT FROM 'draft' OR public._negotiation_items_issued(p_parent_id) THEN
      RAISE EXCEPTION 'replace_child_rows: råvarer kan bare erstattes i et utkast uten utstedte lenker'
        USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_rows) e
       WHERE (e->>'negotiation_id') IS DISTINCT FROM p_parent_id::text
    ) THEN
      RAISE EXCEPTION 'replace_child_rows: rader må tilhøre p_parent_id' USING ERRCODE = '22023';
    END IF;
  END IF;

  EXECUTE format('DELETE FROM public.%I WHERE %I = $1', p_table, p_parent_column)
    USING p_parent_id;

  IF jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position),
         string_agg('(r).' || quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_cols, v_sel
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = p_table
    AND c.column_name IN (
      SELECT DISTINCT k FROM jsonb_array_elements(p_rows) e, jsonb_object_keys(e) k
    );

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'replace_child_rows: ingen gyldige kolonner i payload for %', p_table;
  END IF;

  EXECUTE format(
    'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(null::public.%I, $1) r',
    p_table, v_cols, v_sel, p_table
  ) USING p_rows;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- (2) set_rfq_password — parent lock, same auth check, atomic draft -> invited.
create or replace function public.set_rfq_password(p_recipient_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_pw text; v_le uuid; v_parent uuid; v_status text;
begin
  select nr.negotiation_id into v_parent
    from public.negotiation_recipients nr where nr.id = p_recipient_id;
  if v_parent is null then raise exception 'Recipient not found'; end if;

  select n.legal_entity_id, n.status into v_le, v_status
    from public.negotiations n where n.id = v_parent for update;
  if v_le is null then raise exception 'Recipient not found'; end if;

  perform 1 from public.negotiation_recipients nr
   where nr.id = p_recipient_id and nr.negotiation_id = v_parent for update;
  if not found then raise exception 'Recipient not found'; end if;

  if public.has_ravarer_invoice_access(v_le, 'write') is not true then
    raise exception 'Not authorized';
  end if;

  v_pw := public.gen_rfq_password();
  update public.negotiation_recipients
     set password_hash = crypt(v_pw, gen_salt('bf', 10)),
         password_set_at = now(),
         password_expires_at = now() + interval '5 minutes',
         failed_attempts = 0,
         locked_until = null,
         invited_at = coalesce(invited_at, now())
   where id = p_recipient_id;

  update public.negotiations set rfq_issued_at=coalesce(rfq_issued_at,now()) where id=v_parent;
  if v_status = 'draft' then
    update public.negotiations set status = 'invited' where id = v_parent and status = 'draft';
  end if;
  return v_pw;
end $function$;

-- (3) No non-draft -> draft reset.
create or replace function public._negotiations_no_draft_reset()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.status is distinct from 'draft' and new.status = 'draft' then
    raise exception 'Forhandling kan ikke settes tilbake til utkast' using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists trg_negotiations_no_draft_reset on public.negotiations;
create trigger trg_negotiations_no_draft_reset
  before update of status on public.negotiations
  for each row execute function public._negotiations_no_draft_reset();

-- (4) Backstop on item deletion.
create or replace function public._negotiation_items_delete_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Genuine cascade from an authorized parent deletion: parent already gone.
  perform 1 from public.negotiations n where n.id = old.negotiation_id for update;
  if not found then return old; end if;

  if exists (select 1 from public.negotiations n where n.id=old.negotiation_id and n.rfq_issued_at is not null)
     or exists (select 1 from public.negotiation_recipients nr
              where nr.negotiation_id = old.negotiation_id
                and (nr.invited_at is not null or nr.password_set_at is not null))
     or exists (select 1 from public.negotiation_responses r where r.negotiation_item_id = old.id)
     or exists (select 1 from public.negotiation_outcomes o where o.negotiation_item_id = old.id)
  then
    raise exception 'Råvaren kan ikke fjernes etter at lenker er utstedt eller tilbud finnes'
      using errcode = '55000';
  end if;
  return old;
end $$;
revoke all on function public._negotiation_items_delete_guard() from public, anon, authenticated;
drop trigger if exists trg_negotiation_items_delete_guard on public.negotiation_items;
create trigger trg_negotiation_items_delete_guard
  before delete on public.negotiation_items
  for each row execute function public._negotiation_items_delete_guard();

commit;
