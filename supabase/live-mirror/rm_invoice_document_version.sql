-- ALREADY APPLIED LIVE by root. Repository mirror only — do NOT re-apply.
-- Read-only cache identity for the current private original. This is not a content hash.
CREATE OR REPLACE FUNCTION public.rm_invoice_document_version(p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE i public.invoices%rowtype; o storage.objects%rowtype; parts text[]; token text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
 SELECT * INTO i FROM public.invoices WHERE id=p_invoice_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF public.has_ravarer_invoice_access(i.legal_entity_id,'read') IS DISTINCT FROM true THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF i.source_document_url IS NULL OR btrim(i.source_document_url)='' THEN
  RETURN jsonb_build_object('available',false,'invoice_id',i.id,'reason','document_missing');
 END IF;
 parts:=string_to_array(i.source_document_url,'/');
 IF i.legal_entity_id IS NULL OR array_length(parts,1)<2 OR parts[1] IS DISTINCT FROM i.legal_entity_id::text
    OR length(i.source_document_url)>1024 OR i.source_document_url ~* '(%2e|%2f|%5c)'
    OR position(chr(92) in i.source_document_url)>0
    OR EXISTS(SELECT 1 FROM unnest(parts) p WHERE p IN ('','.','..')) THEN
  RETURN jsonb_build_object('available',false,'invoice_id',i.id,'reason','document_path_invalid');
 END IF;
 SELECT * INTO o FROM storage.objects WHERE bucket_id='invoice-pdfs' AND name=i.source_document_url;
 IF NOT FOUND THEN RETURN jsonb_build_object('available',false,'invoice_id',i.id,'reason','document_missing'); END IF;
 -- ID covers delete/recreate; version+timestamp cover overwrite; ETag/size cover metadata variants.
 token:=md5(jsonb_build_array(o.id,o.name,o.version,o.updated_at,o.metadata->'eTag',o.metadata->'etag',o.metadata->'size')::text);
 RETURN jsonb_build_object('available',true,'invoice_id',i.id,'path',o.name,'object_id',o.id,
  'version',token,'storage_version',o.version,'updated_at',o.updated_at);
END $function$;
REVOKE ALL ON FUNCTION public.rm_invoice_document_version(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rm_invoice_document_version(uuid) TO authenticated;
COMMENT ON FUNCTION public.rm_invoice_document_version(uuid) IS 'Read-only authorized private invoice PDF identity for cache invalidation. Not a byte hash or immutable historical version URL.';
