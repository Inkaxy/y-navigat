CREATE OR REPLACE FUNCTION public._rm_reread_values(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE k text; n numeric; outj jsonb:='{}';
 allowed constant text[]:=ARRAY['supplier_sku','description','quantity','unit','package_size','package_unit','count_per_package','unit_price','total_amount','line_kind','unit_price_basis','discount_amount'];
 numeric_fields constant text[]:=ARRAY['quantity','package_size','count_per_package','unit_price','total_amount','discount_amount'];
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ugyldige_felt'; END IF;
 FOR k IN SELECT jsonb_object_keys(p) LOOP
  IF NOT k=ANY(allowed) THEN RAISE EXCEPTION 'ukjent_felt: %',k; END IF;
  IF p->k <> 'null'::jsonb THEN
   IF k=ANY(numeric_fields) THEN
    IF jsonb_typeof(p->k)<>'number' THEN RAISE EXCEPTION 'ugyldig_tall: %',k; END IF;
    n:=(p->>k)::numeric;
    IF NOT rm_is_finite(n) OR (k IN ('package_size','count_per_package') AND n<=0) OR (k='discount_amount' AND n<0) THEN RAISE EXCEPTION 'ugyldig_tall: %',k; END IF;
   ELSE
    IF jsonb_typeof(p->k)<>'string' OR length(p->>k)>2000 THEN RAISE EXCEPTION 'ugyldig_tekst: %',k; END IF;
    IF k='line_kind' AND NOT (p->>k)=ANY(ARRAY['vare','pant','frakt','gebyr','rabatt','avrunding','mva','annet']) THEN RAISE EXCEPTION 'ugyldig_linjetype'; END IF;
    IF k='unit_price_basis' AND NOT (p->>k)=ANY(ARRAY['mengdeenhet','pakning','stk','kg','g','l','ml']) THEN RAISE EXCEPTION 'ugyldig_prisgrunnlag'; END IF;
   END IF;
  END IF;
  outj:=outj||jsonb_build_object(k,p->k);
 END LOOP;
 RETURN outj;
END $function$
