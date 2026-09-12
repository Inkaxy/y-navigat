-- ANVENDT LIVE 2026-09-12 i prosjekt xpgoztaraqdvliitkkfv som versjon
-- 20260912204709_scope_close_delivered_orders_to_user_entities.
-- SKAL IKKE KJØRES PÅ NYTT. Denne filen er en ordrett kopi hentet fra
-- supabase_migrations.schema_migrations.statements, lagt her fordi
-- supabase/migrations/ er låst av migrasjonsverktøyet og ikke kan skrives
-- direkte uten å kjøre DDL-en om igjen.
--
-- NBHUB internal launch: close_delivered_orders avgrenses til selskapene
-- brukeren faktisk har stilling i. Signatur, ACL og cron/service-oppførsel er
-- uendret, og ingen ordre ble oppdatert — kun funksjonsdefinisjonen.
CREATE OR REPLACE FUNCTION public.close_delivered_orders(p_until date DEFAULT (CURRENT_DATE - 1))
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Innlogget bruker må ha skrivetilgang på ordre. Kall uten JWT-kontekst
  -- (cron/service) slipper gjennom, men de kan uansett ikke nås fra PostgREST lenger.
  IF auth.uid() IS NOT NULL AND public.has_app_write_access('ordre') IS NOT TRUE THEN
    RAISE EXCEPTION 'Mangler skrivetilgang på ordre' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL AND auth.role() IS NOT NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Ikke autorisert' USING ERRCODE = '42501';
  END IF;

  WITH lukkbare AS (
    SELECT o.id
    FROM public.orders o
    WHERE o.delivery_date <= p_until
      AND (auth.uid() IS NULL OR public.has_position_in_entity(o.legal_entity_id))
      AND COALESCE(o.is_return, false) = false
      AND o.status IN ('confirmed','in_production','packed')
      AND EXISTS (
        SELECT 1 FROM public.delivery_note_lines dnl
        JOIN public.delivery_notes dn ON dn.id = dnl.delivery_note_id
        WHERE dnl.order_id = o.id AND dn.status <> 'cancelled'
      )
  )
  UPDATE public.orders o
     SET status = 'delivered', status_changed_at = now(), updated_at = now()
    FROM lukkbare l
   WHERE o.id = l.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
