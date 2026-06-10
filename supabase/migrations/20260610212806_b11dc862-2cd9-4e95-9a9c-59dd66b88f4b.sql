
-- 1) products.in_pos
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS in_pos boolean NOT NULL DEFAULT false;

-- 2) UNIQUE på pos_customers.source_customer_id (delvis, ignorerer NULL)
CREATE UNIQUE INDEX IF NOT EXISTS pos_customers_source_customer_id_uniq
  ON public.pos_customers (source_customer_id)
  WHERE source_customer_id IS NOT NULL;

-- 3) RPC: pos_sync_customer
CREATE OR REPLACE FUNCTION public.pos_sync_customer(
  p_customer_id uuid,
  p_enabled boolean
)
RETURNS public.pos_customers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_c public.customers%ROWTYPE;
  v_row public.pos_customers%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_c FROM public.customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: %', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  -- Autorisasjon: krev posisjon i selskapet + skrivetilgang i kunder-appen
  IF NOT (
    public.is_platform_admin()
    OR (
      public.has_position_in_entity(v_c.legal_entity_id)
      AND public.has_app_write_access('kunder')
    )
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF p_enabled THEN
    INSERT INTO public.pos_customers AS pc (
      legal_entity_id,
      source_customer_id,
      display_name,
      phone,
      email,
      org_number,
      invoice_address,
      credit_limit,
      notes,
      status,
      last_synced_at
    ) VALUES (
      v_c.legal_entity_id,
      v_c.id,
      v_c.display_name,
      COALESCE(v_c.mobile_phone, v_c.primary_contact_phone),
      COALESCE(v_c.invoice_email, v_c.primary_contact_email),
      v_c.organization_number,
      jsonb_build_object(
        'line1',       v_c.billing_address_line1,
        'line2',       v_c.billing_address_line2,
        'postal_code', v_c.billing_postal_code,
        'city',        v_c.billing_city,
        'country',     v_c.billing_country
      ),
      v_c.credit_limit,
      v_c.notes,
      'active',
      now()
    )
    ON CONFLICT (source_customer_id) WHERE source_customer_id IS NOT NULL
    DO UPDATE SET
      display_name    = EXCLUDED.display_name,
      phone           = EXCLUDED.phone,
      email           = EXCLUDED.email,
      org_number      = EXCLUDED.org_number,
      invoice_address = EXCLUDED.invoice_address,
      credit_limit    = EXCLUDED.credit_limit,
      notes           = EXCLUDED.notes,
      status          = 'active',
      last_synced_at  = now()
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.pos_customers
       SET status = 'inactive',
           last_synced_at = now()
     WHERE source_customer_id = v_c.id
    RETURNING * INTO v_row;
    -- Hvis ingen rad finnes, returner NULL-rad uten å feile
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pos_sync_customer(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_sync_customer(uuid, boolean) TO authenticated;
