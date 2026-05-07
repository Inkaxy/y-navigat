
-- Extend live_status with new states
alter table public.negotiation_items drop constraint if exists negotiation_items_live_status_check;
alter table public.negotiation_items add constraint negotiation_items_live_status_check
  check (live_status in ('pending','discussing','tentatively_agreed','agreed','declined','parked','confirmed','unconfirmed_active'));

-- Confirmation fields on items
alter table public.negotiation_items
  add column if not exists live_confirmed_at timestamptz,
  add column if not exists live_confirmed_by_supplier boolean not null default false,
  add column if not exists live_supplier_note text,
  add column if not exists live_datasheet_path text,
  add column if not exists live_datasheet_skipped boolean not null default false;

-- Confirmation flow fields on negotiations
alter table public.negotiations
  add column if not exists live_session_paused boolean not null default false,
  add column if not exists live_confirmation_deadline timestamptz,
  add column if not exists live_auto_apply_on_confirm boolean not null default true,
  add column if not exists live_send_reminder_after_days int not null default 7;

-- Storage bucket for live confirmation datasheets (private)
insert into storage.buckets (id, name, public)
values ('negotiation-datasheets', 'negotiation-datasheets', false)
on conflict (id) do nothing;

-- Policy: legal entity members of the negotiation can read uploaded datasheets
drop policy if exists "neg_datasheets_read_members" on storage.objects;
create policy "neg_datasheets_read_members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'negotiation-datasheets'
    and exists (
      select 1 from public.negotiations n
      where n.id::text = split_part(name, '/', 1)
        and public.has_negotiation_read(n.legal_entity_id)
    )
  );

-- Internal members can also delete (cleanup)
drop policy if exists "neg_datasheets_delete_members" on storage.objects;
create policy "neg_datasheets_delete_members" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'negotiation-datasheets'
    and exists (
      select 1 from public.negotiations n
      where n.id::text = split_part(name, '/', 1)
        and public.has_negotiation_write(n.legal_entity_id)
    )
  );
-- Note: supplier uploads happen via service-role signed URLs from edge function,
-- so no public/anon insert policy is required.
