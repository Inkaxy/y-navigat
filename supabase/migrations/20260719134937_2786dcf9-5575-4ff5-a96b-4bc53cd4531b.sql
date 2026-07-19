
-- Kundeportal: gjøre finalized pakksedler tilgjengelig for kunden

CREATE OR REPLACE FUNCTION public.portal_list_delivery_notes(
  p_from date DEFAULT (CURRENT_DATE - INTERVAL '90 days')::date,
  p_to   date DEFAULT (CURRENT_DATE + INTERVAL '7 days')::date
)
RETURNS TABLE(
  delivery_note_id uuid,
  display_number text,
  delivery_date date,
  status text,
  finalized_at timestamptz,
  delivery_tour_id uuid,
  tour_number smallint,
  route_label text,
  line_count integer,
  subtotal_excl_vat numeric,
  total_vat numeric,
  total_incl_vat numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    dn.id,
    dn.display_number,
    dn.delivery_date,
    dn.status,
    dn.finalized_at,
    dn.delivery_tour_id,
    dt.tour_number,
    dn.route_label,
    (SELECT COUNT(*)::int FROM public.delivery_note_lines dnl WHERE dnl.delivery_note_id = dn.id),
    dn.subtotal_excl_vat,
    dn.total_vat,
    dn.total_incl_vat
  FROM public.delivery_notes dn
  LEFT JOIN public.delivery_tours dt ON dt.id = dn.delivery_tour_id
  WHERE dn.customer_id = public.current_portal_customer_id()
    AND dn.finalized_at IS NOT NULL
    AND dn.status <> 'cancelled'
    AND dn.delivery_date BETWEEN p_from AND p_to
  ORDER BY dn.delivery_date DESC, dt.tour_number ASC NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_delivery_note(p_delivery_note_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_result jsonb;
BEGIN
  v_customer_id := public.current_portal_customer_id();
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Ikke en portal-bruker' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'delivery_note', jsonb_build_object(
      'id', dn.id,
      'display_number', dn.display_number,
      'delivery_date', dn.delivery_date,
      'status', dn.status,
      'finalized_at', dn.finalized_at,
      'route_label', dn.route_label,
      'notes', dn.notes,
      'customer_snapshot', dn.customer_snapshot,
      'delivery_address_snapshot', dn.delivery_address_snapshot,
      'tour_number', dt.tour_number,
      'tour_display_name', dt.display_name,
      'subtotal_excl_vat', dn.subtotal_excl_vat,
      'total_vat', dn.total_vat,
      'total_incl_vat', dn.total_incl_vat
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'line_number', dnl.line_number,
          'product_id', dnl.product_id,
          'product_name', dnl.product_snapshot->>'display_name',
          'product_number', dnl.product_snapshot->>'display_number',
          'quantity', dnl.quantity,
          'sales_unit', dnl.sales_unit,
          'unit_price', dnl.unit_price,
          'vat_rate', dnl.vat_rate,
          'line_subtotal_excl_vat', dnl.line_subtotal_excl_vat,
          'line_vat', dnl.line_vat,
          'line_total_incl_vat', dnl.line_total_incl_vat,
          'notes', dnl.notes
        ) ORDER BY dnl.line_number
      )
      FROM public.delivery_note_lines dnl
      WHERE dnl.delivery_note_id = dn.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.delivery_notes dn
  LEFT JOIN public.delivery_tours dt ON dt.id = dn.delivery_tour_id
  WHERE dn.id = p_delivery_note_id
    AND dn.customer_id = v_customer_id
    AND dn.finalized_at IS NOT NULL
    AND dn.status <> 'cancelled';

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Pakkseddel ikke funnet eller ikke tilgjengelig';
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_list_delivery_notes(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_delivery_note(uuid) TO authenticated;
