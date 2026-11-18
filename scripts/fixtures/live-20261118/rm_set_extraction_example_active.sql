CREATE OR REPLACE FUNCTION public.rm_set_extraction_example_active(p_example_id uuid, p_active boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); e invoice_extraction_examples%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into e from invoice_extraction_examples where id = p_example_id for update;
  if not found then raise exception 'finnes_ikke' using errcode = 'P0002'; end if;
  if not has_ravarer_invoice_access(e.legal_entity_id, 'write') then raise exception 'forbidden: Mangler skrivetilgang til fakturaer' using errcode = '42501'; end if;
  if p_active is null then raise exception 'ugyldig_aktiv'; end if;
  if p_active then
    if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'begrunnelse: Bekreft kontroll mot originalen med en begrunnelse.' using errcode = '22023'; end if;
    if not public.rm_extraction_example_is_safe(e.id) then
      raise exception 'uavklart_eksempel: Rett uavklarte tall eller prisgrunnlag i fakturalinjen og lagre et nytt læringseksempel.' using errcode = '22023';
    end if;
  end if;
  update invoice_extraction_examples set is_active = p_active,
    deactivated_at = case when p_active then null else now() end,
    deactivated_by = case when p_active then null else v_uid end
  where id = e.id;
  insert into audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
  values (v_uid, case when p_active then 'extraction_example.activated' else 'extraction_example.deactivated' end,
          'supplier', e.supplier_id, e.legal_entity_id, jsonb_build_object('example_id', e.id), nullif(btrim(coalesce(p_reason,'')), ''), 'ravarer');
  return jsonb_build_object('ok', true, 'is_active', p_active);
end $function$
