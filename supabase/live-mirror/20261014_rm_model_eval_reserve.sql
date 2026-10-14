-- Atomic reservation for admin model evaluation: limits are checked and a usage row is reserved
-- under a per-company advisory lock BEFORE any AI call. Only the edge function (service_role) may call it.
create or replace function public.rm_model_eval_reserve(
  p_legal_entity_id uuid, p_invoice_id uuid, p_model text, p_max_per_day integer, p_dedup_seconds integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_id uuid;
begin
  if p_legal_entity_id is null or p_invoice_id is null or coalesce(p_model, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'ugyldig');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invoice_model_eval:' || p_legal_entity_id::text, 0));
  select count(*) into v_n from ai_usage_log
   where purpose = 'invoice_model_eval' and legal_entity_id = p_legal_entity_id and created_at >= now() - interval '24 hours';
  if v_n >= p_max_per_day then return jsonb_build_object('ok', false, 'error', 'daily_limit', 'count', v_n); end if;
  if exists (select 1 from ai_usage_log where purpose = 'invoice_model_eval' and legal_entity_id = p_legal_entity_id
              and invoice_id = p_invoice_id and model = p_model and created_at >= now() - make_interval(secs => p_dedup_seconds)) then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
  end if;
  insert into ai_usage_log (provider, model, purpose, invoice_id, legal_entity_id, success, error_message)
  values ('openai', p_model, 'invoice_model_eval', p_invoice_id, p_legal_entity_id, false, 'reservert')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'reservation_id', v_id, 'count', v_n + 1);
end $$;
revoke all on function public.rm_model_eval_reserve(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rm_model_eval_reserve(uuid, uuid, text, integer, integer) to service_role;