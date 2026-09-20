-- Internal trigger, not a callable application RPC. Trigger invocation remains available.
-- Idempotent re-statement of live migration 'start_price_guard_trigger_revoke_rpc'
-- (applied 20260920212954) so project migration history matches the database.
revoke execute on function public.rm_guard_start_price_columns() from public, anon, authenticated;