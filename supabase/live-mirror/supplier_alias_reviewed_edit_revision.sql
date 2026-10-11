-- LIVE MIRROR — allerede anvendt av root på live Supabase (migrasjon supplier_alias_reviewed_edit_revision).
-- IKKE kjør på nytt og IKKE legg til som migrasjon. Funksjonskroppene under er kontrollert mot
-- live pg_get_functiondef 2026-10-11 22:01 UTC (lest skrivebeskyttet); ACL live:
-- {postgres=X, authenticated=X, service_role=X} for begge funksjoner.
-- Kolonnen `edit_revision bigint NOT NULL DEFAULT 0` finnes live (types.ts).
ALTER TABLE public.raw_material_supplier_aliases
  ADD COLUMN IF NOT EXISTS edit_revision bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.rm_supplier_alias_edit_preview(p_alias_id uuid, p_rms_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE a public.raw_material_supplier_aliases%rowtype; s public.raw_material_suppliers%rowtype;
  e uuid; se uuid; token text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Innlogging kreves' USING ERRCODE='28000'; END IF;
  SELECT * INTO s FROM public.raw_material_suppliers WHERE id=p_rms_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Koblingen finnes ikke' USING ERRCODE='P0002'; END IF;
  SELECT legal_entity_id INTO e FROM public.raw_materials WHERE id=s.raw_material_id;
  SELECT legal_entity_id INTO se FROM public.suppliers WHERE id=s.supplier_id;
  IF e IS NULL OR se IS DISTINCT FROM e
     OR public.has_ravarer_invoice_access(e,'read') IS DISTINCT FROM true
     OR public.rm_can_read(s.raw_material_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Ingen tilgang til aliaset' USING ERRCODE='42501';
  END IF;
  SELECT * INTO a FROM public.raw_material_supplier_aliases WHERE id=p_alias_id AND raw_material_supplier_id=s.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aliaset tilhører ikke koblingen' USING ERRCODE='P0002'; END IF;
  -- Exclude volatile observation counters; include semantic state and parent identity.
  -- Epoch avoids session-TimeZone differences in timestamptz JSON serialization.
  token := md5(jsonb_build_object('id',a.id,'rms',s.id,'rm',s.raw_material_id,'supplier',s.supplier_id,
    'entity',e,'link_revision',extract(epoch FROM s.updated_at),
    'edit_revision',a.edit_revision,'type',a.alias_type,'value',a.alias_value,'normalized',a.alias_value_normalized,'status',a.status,
    'confirmed_by',a.confirmed_by,'confirmed_at',extract(epoch FROM a.confirmed_at),
    'rejected_by',a.rejected_by,'rejected_at',extract(epoch FROM a.rejected_at),'rejected_reason',a.rejected_reason)::text);
  RETURN jsonb_build_object('schema_version',1,'alias_id',a.id,'rms_id',s.id,'raw_material_id',s.raw_material_id,
    'supplier_id',s.supplier_id,'legal_entity_id',e,'alias_type',a.alias_type,'alias_value',a.alias_value,
    'status',a.status,'edit_revision',a.edit_revision,'match_count',a.match_count,'last_seen_at',a.last_seen_at,'expected_snapshot',token,
    'confirmed_by',a.confirmed_by,'confirmed_at',a.confirmed_at,
    'rejected_by',a.rejected_by,'rejected_at',a.rejected_at,'rejected_reason',a.rejected_reason,
    'can_edit',public.has_ravarer_invoice_access(e,'write') IS NOT DISTINCT FROM true
       AND public.rm_can_write(s.raw_material_id) IS NOT DISTINCT FROM true,
    'scope','future_matching_only');
END $function$;

CREATE OR REPLACE FUNCTION public.rm_edit_supplier_alias(p_alias_id uuid, p_rms_id uuid, p_expected_snapshot text, p_action text, p_reason text, p_new_value text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE a public.raw_material_supplier_aliases%rowtype; s public.raw_material_suppliers%rowtype;
  e uuid; se uuid; v_before jsonb; v_after jsonb; v_result_id uuid; v_value text; v_uid uuid:=auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Innlogging kreves' USING ERRCODE='28000'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('confirm','reject','replace') THEN
    RAISE EXCEPTION 'Ukjent aliashandling' USING ERRCODE='22023'; END IF;
  IF nullif(btrim(p_reason),'') IS NULL OR char_length(p_reason)>2000 THEN
    RAISE EXCEPTION 'Begrunnelse kreves (maks 2000 tegn)' USING ERRCODE='22023'; END IF;
  IF p_action<>'replace' AND p_new_value IS NOT NULL THEN
    RAISE EXCEPTION 'Ny verdi brukes bare ved retting' USING ERRCODE='22023'; END IF;
  -- Same parent-before-child lock order as the link editing workflow.
  SELECT * INTO s FROM public.raw_material_suppliers WHERE id=p_rms_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Koblingen finnes ikke' USING ERRCODE='P0002'; END IF;
  SELECT legal_entity_id INTO e FROM public.raw_materials WHERE id=s.raw_material_id;
  SELECT legal_entity_id INTO se FROM public.suppliers WHERE id=s.supplier_id;
  IF e IS NULL OR se IS DISTINCT FROM e
     OR public.has_ravarer_invoice_access(e,'write') IS DISTINCT FROM true
     OR public.rm_can_write(s.raw_material_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Ingen skrivetilgang til aliaset' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.raw_material_supplier_aliases WHERE id=p_alias_id AND raw_material_supplier_id=s.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aliaset tilhører ikke koblingen' USING ERRCODE='P0002'; END IF;
  v_before:=public.rm_supplier_alias_edit_preview(a.id,s.id);
  IF p_expected_snapshot IS NULL OR p_expected_snapshot IS DISTINCT FROM v_before->>'expected_snapshot' THEN
    RAISE EXCEPTION 'Aliaset eller koblingen er endret. Hent på nytt.' USING ERRCODE='40001'; END IF;
  IF a.status='superseded' THEN
    RAISE EXCEPTION 'Aliaset er erstattet. Rediger det gjeldende aliaset.' USING ERRCODE='22023'; END IF;
  v_result_id:=a.id;
  IF p_action='confirm' THEN
    IF a.status='confirmed' THEN RAISE EXCEPTION 'Aliaset er allerede bekreftet' USING ERRCODE='22023'; END IF;
    -- Only the types the matching engine actually interprets can be confirmed here.
    IF a.alias_type::text NOT IN ('supplier_sku','product_name') THEN
      RAISE EXCEPTION 'Denne aliastypen støttes ikke av fakturamatchingen' USING ERRCODE='22023'; END IF;
    UPDATE public.raw_material_supplier_aliases SET edit_revision=edit_revision+1,status='confirmed',confirmed_by=v_uid,confirmed_at=clock_timestamp(),
      rejected_by=NULL,rejected_at=NULL,rejected_reason=NULL WHERE id=a.id;
  ELSIF p_action='reject' THEN
    IF a.status='rejected' THEN RAISE EXCEPTION 'Aliaset er allerede avvist' USING ERRCODE='22023'; END IF;
    UPDATE public.raw_material_supplier_aliases SET edit_revision=edit_revision+1,status='rejected',rejected_by=v_uid,rejected_at=clock_timestamp(),
      rejected_reason=btrim(p_reason) WHERE id=a.id;
  ELSE
    v_value:=btrim(p_new_value);
    IF v_value IS NULL OR char_length(v_value)=0 OR char_length(v_value)>500 OR v_value !~ '[[:alnum:]]' THEN
      RAISE EXCEPTION 'Oppgi et gyldig alias (maks 500 tegn)' USING ERRCODE='22023'; END IF;
    IF lower(v_value)=lower(btrim(a.alias_value)) THEN
      RAISE EXCEPTION 'Aliasverdien er uendret' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.raw_material_supplier_aliases WHERE raw_material_supplier_id=s.id
        AND alias_type=a.alias_type AND alias_value_normalized=lower(v_value)) THEN
      RAISE EXCEPTION 'Verdien finnes allerede på koblingen. Åpne det aliaset.' USING ERRCODE='23505'; END IF;
    -- Preserve historical observation identity. Corrected value is a NEW pending alias,
    -- requiring separate explicit confirmation; old counters/first invoice are not copied.
    -- A rejected old value is negative learning and must remain rejected: superseding
    -- it would remove the matcher's direct-SKU/name block for that old value.
    UPDATE public.raw_material_supplier_aliases SET edit_revision=edit_revision+1,
      status=CASE WHEN status='rejected' THEN status ELSE 'superseded'::public.alias_status END WHERE id=a.id;
    INSERT INTO public.raw_material_supplier_aliases(raw_material_supplier_id,alias_type,alias_value,status,match_count)
      VALUES(s.id,a.alias_type,v_value,'pending',0) RETURNING id INTO v_result_id;
  END IF;
  v_after:=public.rm_supplier_alias_edit_preview(v_result_id,s.id);
  INSERT INTO public.audit_log(user_id,action,entity_type,entity_id,entity_display_reference,legal_entity_id,changes,reason,source_app)
    VALUES(v_uid,'supplier_alias.'||p_action,'raw_material_supplier_alias',a.id,a.alias_value,e,
      jsonb_build_object('before',v_before,'after',v_after,'replacement_alias_id',CASE WHEN p_action='replace' THEN v_result_id END,
        'invoice_lines_changed',0,'cost_prices_changed',0),btrim(p_reason),'ravarer');
  RETURN jsonb_build_object('ok',true,'action',p_action,'alias',v_after,'invoice_lines_changed',0,'cost_prices_changed',0);
END $function$;

REVOKE ALL ON FUNCTION public.rm_supplier_alias_edit_preview(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rm_edit_supplier_alias(uuid,uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_supplier_alias_edit_preview(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rm_edit_supplier_alias(uuid,uuid,text,text,text,text) TO authenticated;
