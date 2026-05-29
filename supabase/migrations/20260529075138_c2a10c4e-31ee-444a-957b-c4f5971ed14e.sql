
CREATE OR REPLACE FUNCTION public.undo_delivery_runs(
  p_legal_entity_id uuid,
  p_delivery_date   date,
  p_tour_filter     uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id          uuid := auth.uid();
  v_notes_deleted    int  := 0;
  v_lines_deleted    int  := 0;
  v_runs_cancelled   int  := 0;
  v_orders_deleted   int  := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (has_position_in_entity(p_legal_entity_id) AND has_app_write_access('ordre')) THEN
    RAISE EXCEPTION 'Insufficient privileges for legal_entity %', p_legal_entity_id;
  END IF;

  -- 1) Slett pakkseddel-linjer (CASCADE fra notes, men vi teller dem)
  WITH target_notes AS (
    SELECT dn.id
      FROM public.delivery_notes dn
     WHERE dn.legal_entity_id = p_legal_entity_id
       AND dn.delivery_date   = p_delivery_date
       AND (
         p_tour_filter IS NULL
         OR dn.delivery_tour_id = ANY(p_tour_filter)
       )
  ),
  del_lines AS (
    DELETE FROM public.delivery_note_lines dnl
     USING target_notes tn
     WHERE dnl.delivery_note_id = tn.id
     RETURNING 1
  )
  SELECT count(*) INTO v_lines_deleted FROM del_lines;

  -- 2) Slett pakksedlene
  WITH del_notes AS (
    DELETE FROM public.delivery_notes dn
     WHERE dn.legal_entity_id = p_legal_entity_id
       AND dn.delivery_date   = p_delivery_date
       AND (
         p_tour_filter IS NULL
         OR dn.delivery_tour_id = ANY(p_tour_filter)
       )
     RETURNING 1
  )
  SELECT count(*) INTO v_notes_deleted FROM del_notes;

  -- 3) Marker kjøringer for valgt dato/scope som "cancelled"
  WITH upd AS (
    UPDATE public.delivery_note_runs r
       SET status = 'cancelled',
           finished_at = COALESCE(r.finished_at, now()),
           details = COALESCE(r.details, '{}'::jsonb)
                     || jsonb_build_object(
                          'undone_at', now(),
                          'undone_by', v_user_id,
                          'previous_status', r.status
                        )
     WHERE r.legal_entity_id = p_legal_entity_id
       AND r.delivery_date   = p_delivery_date
       AND r.status <> 'cancelled'
       AND (
         p_tour_filter IS NULL
         OR r.tour_filter IS NULL
         OR r.tour_filter && p_tour_filter
       )
     RETURNING 1
  )
  SELECT count(*) INTO v_runs_cancelled FROM upd;

  -- 4) Slett fastordre som ble materialisert for denne datoen og som ikke
  --    har andre referanser (pakkseddel-linjer er allerede slettet).
  WITH del_orders AS (
    DELETE FROM public.orders o
     WHERE o.legal_entity_id = p_legal_entity_id
       AND o.delivery_date   = p_delivery_date
       AND o.recurring_schedule_id IS NOT NULL
       AND (
         p_tour_filter IS NULL
         OR o.delivery_tour_id = ANY(p_tour_filter)
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.delivery_note_lines dnl WHERE dnl.order_id = o.id
       )
     RETURNING 1
  )
  SELECT count(*) INTO v_orders_deleted FROM del_orders;

  RETURN jsonb_build_object(
    'notes_deleted', v_notes_deleted,
    'lines_deleted', v_lines_deleted,
    'runs_cancelled', v_runs_cancelled,
    'recurring_orders_deleted', v_orders_deleted,
    'delivery_date', p_delivery_date,
    'tour_filter', p_tour_filter
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.undo_delivery_runs(uuid, date, uuid[]) TO authenticated;
