
ALTER TABLE public.legal_entities ADD COLUMN IF NOT EXISTS gln text, ADD COLUMN IF NOT EXISTS ng_supplier_name text;
UPDATE public.legal_entities SET gln='7080003620927', ng_supplier_name='NØTTERØ BAKERI & KONDITORI ENGROS AS' WHERE id='751709bc-04b3-4449-867d-b97faa9ab373';

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS ng_reportable boolean NOT NULL DEFAULT false;
UPDATE public.customers SET ng_reportable=true WHERE gln IN ('7080000002153','7080000003679','7080000003990','7080000004119','7080000032075','7080000456635','7080000569090','7080000590315','7080000748273','7080000907809','7080000915156','7080000927807','7080000957606','7080001007157','7080001008147','7080001061883','7080001061890','7080001078485','7080001100063','7080001110628','7080001113209','7080001174286','7080001179694','7080001195120','7080001208936','7080001225261','7080001233648','7080001268886','7080001347918','7080001381936','7080001395766','7080001438692','7080003329691','7080003509482','7080004322646','7080004390164','7080004390188','7080004390201','7080004390218','7080004390225','7080011117761');

UPDATE public.products AS p SET gtin = v.gtin FROM (VALUES
  ('c88ac46e-91ef-45d1-a624-40f69580ff64'::uuid, '7059260000223'),
  ('623f09b1-8801-4c44-a6e2-ce901b28d187'::uuid, '7059260000124'),
  ('f398871a-d2cf-40a9-b9c7-ae232f9f441e'::uuid, '7059260002050'),
  ('f6ec6b7b-1a91-4ad3-912f-2323539cf732'::uuid, '7059260000957'),
  ('4e44d49a-909a-442c-9796-b4aa649e927e'::uuid, '7059260009486'),
  ('90181642-7bbb-4696-99a9-262544b33eeb'::uuid, '7059260011182'),
  ('4590a533-aef6-441e-83b7-234b2bc51f20'::uuid, '7059260000742'),
  ('ff26c545-5249-4a77-8b93-e2dae9e47a9d'::uuid, '7059260000803'),
  ('fb301b39-fe3c-43a2-9439-fcd5a9d7c45d'::uuid, '7059260020023'),
  ('74c98c44-ee16-4d85-9c55-6e078ce7a6fd'::uuid, '7059260003071'),
  ('dfa7ad4f-6ec3-4676-921b-9b9120922199'::uuid, '7059260031272'),
  ('d464a408-125c-42b5-8357-75d5c1352906'::uuid, '7059260002111'),
  ('e2ef2f5d-56e5-4b49-bb85-681675e2d868'::uuid, '7059260031265'),
  ('c4911fde-05a5-48fc-9797-2a2b65e258bf'::uuid, '7059260010901'),
  ('42559fb4-1fa3-4e1f-a1b4-01b16342d652'::uuid, '7059260020047'),
  ('cb391e1a-3bc5-415a-87ee-dd0b113785d2'::uuid, '7059260004290'),
  ('f9afedb6-a9c2-4fac-a09a-6c6578a922f5'::uuid, '7059260002036'),
  ('dfe28767-d9b5-4a6d-9f30-43872ea39698'::uuid, '7059260002074'),
  ('aced7911-f0ce-4f4f-8db8-c607873b35c1'::uuid, '7059260002043'),
  ('2ffe67e4-634e-4aed-bcf4-6a89b96c9e04'::uuid, '7059260020016'),
  ('a3267c51-63ff-4c9f-9a75-ace3e4cac4e2'::uuid, '7059260000728'),
  ('46fe7af6-7815-42ab-9187-97f76d544589'::uuid, '7059260031258'),
  ('2daaf372-96a3-438f-87b5-3477d153bc12'::uuid, '7059260000735'),
  ('2452416f-8ecc-4bf3-9bea-7cfc8a903e6e'::uuid, '7059260000827'),
  ('836d4bad-6d89-4090-9e19-9a9da21d6e31'::uuid, '7059260009585'),
  ('1988a8b1-353a-4992-879f-660e4cbb9277'::uuid, '7059260020337'),
  ('f52747bc-4d18-4bb3-ae30-d4603aa38991'::uuid, '7059260000841'),
  ('cbff8a9c-5e38-46c0-b1f0-e9d2a3d180c2'::uuid, '7059260004306'),
  ('23fc5d8c-9620-40ae-896a-fe4011d248d0'::uuid, '7059260003064'),
  ('660ef665-f7e7-47d7-97fe-b88a78a0de58'::uuid, '7059260031289'),
  ('81798920-f66a-4b8d-874b-2051616fb739'::uuid, '7059260020061'),
  ('2f154a42-b8d4-44aa-b854-fb1eb53247c6'::uuid, '7059260000056'),
  ('06643d54-531e-4fb7-a00a-bd4346aa8311'::uuid, '7059260020085'),
  ('64d9819b-2e27-4877-a2ac-5bd6976f90d7'::uuid, '7059260020054'),
  ('353cef2b-cd3c-4bc2-99c5-5bc8d264d0b0'::uuid, '7059260031296'),
  ('0afbfa32-a5ac-41c4-8a11-ceabe892fdec'::uuid, '7059260020320'),
  ('2cb92945-2e9a-49c0-8a0d-257dbd99f52c'::uuid, '7059260000858'),
  ('e49e73c4-c389-46f7-9ac8-26f6d3d3995a'::uuid, '7059260030275'),
  ('eba756c9-abaf-4655-a8a7-d92a3a46103b'::uuid, '7059260020740'),
  ('6d2bbc0d-290a-475a-8e55-17e9ddcfe8ba'::uuid, '7059260004245'),
  ('bfecc87d-2d42-47e7-bee2-aaa9f67abdb2'::uuid, '7059260004191'),
  ('1bee490e-6ab5-430c-bd33-c49933aa8a11'::uuid, '7059260004221'),
  ('ae697f83-0952-4ce2-a8f6-af2033623796'::uuid, '7059260030282'),
  ('4fe5f453-c725-497f-a098-ad61ce56a68f'::uuid, '7059260031357'),
  ('930be72e-cebf-486c-9655-38563cebed18'::uuid, '7059260031241'),
  ('7cf75d6f-f22e-4c99-a602-c5a55e11faaa'::uuid, '7059260004054'),
  ('51feb26a-ae34-4590-9a61-89f8d3ba10b8'::uuid, '7059260030039'),
  ('6f1b9fb7-7f75-47a8-89a1-939f39a5a403'::uuid, '7059260020191'),
  ('d96e0b8e-ebb7-4b3e-910d-37321e4c2ce2'::uuid, '7059260020207'),
  ('2aaf97a9-af72-44b8-b5bd-e4c7d4f17260'::uuid, '7059260004238'),
  ('9a150513-48b5-48f6-9d6f-471558054f93'::uuid, '7059260000797'),
  ('eec85097-7b26-42b8-a196-2a9147b8ffb7'::uuid, '7059260031036'),
  ('72fbb858-fa91-4cd6-94c2-fd1dce85e550'::uuid, '7059260030053'),
  ('1fb83716-18ff-4059-9951-a4c4db7da86e'::uuid, '7059260000254'),
  ('d15813ed-c8e3-419e-822d-657aa6f1b4ab'::uuid, '7059260030060'),
  ('1e328ad7-669f-4235-9b6f-6261753d2bc4'::uuid, '7059260020696'),
  ('e97319b9-e78b-4741-918f-0ce6b8991089'::uuid, '7059260000247'),
  ('daff7720-8116-44ff-8b21-bfc1aece0314'::uuid, '7059260004313'),
  ('5cde7023-d4c1-436f-9168-e34e62054af4'::uuid, '7059260020412'),
  ('8dd270bb-6399-499f-8194-5ed32ed93b9b'::uuid, '7059260020528'),
  ('de94bb70-3ddf-4103-9bd0-5f840dae99c9'::uuid, '7059260020689'),
  ('a5c68492-9a78-4f67-90bd-f2442a19ba62'::uuid, '7059260000308'),
  ('4ca9334e-1c0f-4ece-be25-1de47935bbac'::uuid, '7059260004023'),
  ('cf46da07-30f2-44c2-83bc-f4a5e6bc46ae'::uuid, '7059260020801'),
  ('62e3967f-44aa-4666-aa45-8054a2c4bbee'::uuid, '7059260000759'),
  ('202b2e22-4f56-4ae3-a11f-8626205a2f2f'::uuid, '7059260003057'),
  ('d6f1ecec-3d4a-4174-977e-2fd701b16ec7'::uuid, '7059260003187'),
  ('70e3fc68-9212-4d2e-b539-6fa1af9d6053'::uuid, '7059260030787'),
  ('741500af-ce0b-442f-b159-69d016d5965a'::uuid, '7059260030374'),
  ('515b4c99-b149-4131-a15c-a83c7a1aa6d3'::uuid, '7059260020436'),
  ('b5282770-63ae-4732-b855-1f881d797f61'::uuid, '7059260004214'),
  ('90925989-8e1a-422b-a8fc-f3bb0bc828a9'::uuid, '7059260011267'),
  ('77e9983d-334c-4154-81d4-06d59e3d20e6'::uuid, '7059260000025'),
  ('58c51bdf-e2ba-4337-90eb-f4dda51c612f'::uuid, '7059260011304'),
  ('e9d81cb0-f995-4585-be86-7ad748007a05'::uuid, '7059260020252'),
  ('818103bc-e77e-439c-abe4-956f7aa5917b'::uuid, '7059260031029'),
  ('84a52ea6-9091-4789-86e1-0f049415fae9'::uuid, '7059260020092'),
  ('f3076547-2e9b-4dc0-95ca-1e29b5959171'::uuid, '7059260030411'),
  ('e41346f0-372c-4630-a243-fa20cac31d2a'::uuid, '7059260000766'),
  ('59e1e774-5177-4844-999f-9284fd84290b'::uuid, '7059260003194'),
  ('13916fe9-c326-454a-bedf-c43c44f554b1'::uuid, '7059260003156'),
  ('ecb6f45a-81ef-43ac-a31c-6f8912d8eb9f'::uuid, '7059260020559'),
  ('4a5ff2e1-2f0b-4dd5-8211-ffef6d5918a3'::uuid, '7059260020566'),
  ('6264cb88-aa74-41d4-b95d-633f7682fdaa'::uuid, '7059260000018'),
  ('d2c522ff-1eba-4332-b0a4-0e3edb2001a9'::uuid, '7059260000148'),
  ('a470f906-3001-4a73-9b85-d25a5f8a25e2'::uuid, '7059260000216'),
  ('8761418d-122d-4476-ad5d-304db7edb209'::uuid, '7059260010888'),
  ('2437efe5-8d44-4d1a-8010-d340429f3f4e'::uuid, '7059260000520'),
  ('b6e953d6-6d8d-4a0c-98d3-255f0837bb48'::uuid, '7059260000155'),
  ('4cd1473d-b42e-4881-ada8-0ea32e4b8b15'::uuid, '7059260000186'),
  ('2eb8b30d-b1c2-4576-8ceb-81a6c8556b4e'::uuid, '7059260011212'),
  ('a2095b79-d51c-4563-a0b3-90a17e77c609'::uuid, '7059260011229'),
  ('55d79591-0453-4604-af9e-b4b6debcfb28'::uuid, '7059260010017'),
  ('585ed34f-1cbe-49bb-b666-365cc18a8d22'::uuid, '7059260000100')
) AS v(id, gtin) WHERE p.id = v.id AND (p.gtin IS NULL OR p.gtin = '');

INSERT INTO public.statistic_group_members (group_id, product_id)
SELECT g.id, p.id FROM public.statistic_groups g
JOIN public.products p ON p.gtin IS NOT NULL AND p.gtin <> '' AND p.legal_entity_id = g.legal_entity_id
WHERE g.display_name='NG-sortiment' AND g.legal_entity_id='751709bc-04b3-4449-867d-b97faa9ab373'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES public.legal_entities(id),
  report_type text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  row_count integer NOT NULL,
  customer_count integer NOT NULL,
  product_count integer NOT NULL,
  total_amount numeric(14,2) NOT NULL,
  file_name text NOT NULL,
  file_path text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.report_runs TO authenticated;
GRANT ALL ON public.report_runs TO service_role;

ALTER TABLE public.report_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_runs_select" ON public.report_runs FOR SELECT TO authenticated
USING (public.has_position_in_entity(legal_entity_id) OR public.is_platform_admin());

CREATE POLICY "report_runs_insert" ON public.report_runs FOR INSERT TO authenticated
WITH CHECK (public.has_app_write_access('rapporter') AND (public.has_position_in_entity(legal_entity_id) OR public.is_platform_admin()));

CREATE INDEX IF NOT EXISTS idx_report_runs_entity_created ON public.report_runs(legal_entity_id, created_at DESC);

CREATE POLICY "ng_eksport_read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'ng-eksport'
  AND (
    public.is_platform_admin()
    OR public.has_position_in_entity(public.extract_legal_entity_id_from_path(name))
  )
);

CREATE POLICY "ng_eksport_write" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ng-eksport'
  AND public.has_app_write_access('rapporter')
  AND (
    public.is_platform_admin()
    OR public.has_position_in_entity(public.extract_legal_entity_id_from_path(name))
  )
);

CREATE OR REPLACE FUNCTION public.generate_ng_report(
  p_legal_entity_id uuid,
  p_period_start date,
  p_period_end date
)
RETURNS TABLE(kunde_gln text, kunde_navn text, vare_gtin text, vare_navn text, kjop_belop numeric, kjop_antall numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_platform_admin() OR (public.has_position_in_entity(p_legal_entity_id) AND public.app_access_level('rapporter') <> 'none')) THEN
    RAISE EXCEPTION 'Ingen tilgang til rapporter for denne enheten';
  END IF;

  RETURN QUERY
  SELECT c.gln::text, c.display_name::text, pr.gtin::text, pr.display_name::text,
         SUM(ol.line_subtotal_excl_vat)::numeric, SUM(ol.quantity)::numeric
  FROM public.order_lines ol
  JOIN public.orders o ON o.id = ol.order_id
  JOIN public.customers c ON c.id = o.customer_id
  JOIN public.products pr ON pr.id = ol.product_id
  JOIN public.statistic_group_members m ON m.product_id = pr.id
  JOIN public.statistic_groups g ON g.id = m.group_id
       AND g.display_name = 'NG-sortiment'
       AND g.legal_entity_id = p_legal_entity_id
  WHERE o.legal_entity_id = p_legal_entity_id
    AND o.delivery_date BETWEEN p_period_start AND p_period_end
    AND o.status IN ('delivered','partial_delivery','invoiced')
    AND c.ng_reportable = true
  GROUP BY c.gln, c.display_name, pr.gtin, pr.display_name
  ORDER BY c.display_name, pr.display_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_ng_report_outside(
  p_legal_entity_id uuid,
  p_period_start date,
  p_period_end date
)
RETURNS TABLE(product_id uuid, vare_navn text, belop numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_platform_admin() OR (public.has_position_in_entity(p_legal_entity_id) AND public.app_access_level('rapporter') <> 'none')) THEN
    RAISE EXCEPTION 'Ingen tilgang til rapporter for denne enheten';
  END IF;

  RETURN QUERY
  SELECT pr.id, pr.display_name::text, SUM(ol.line_subtotal_excl_vat)::numeric
  FROM public.order_lines ol
  JOIN public.orders o ON o.id = ol.order_id
  JOIN public.customers c ON c.id = o.customer_id
  JOIN public.products pr ON pr.id = ol.product_id
  WHERE o.legal_entity_id = p_legal_entity_id
    AND o.delivery_date BETWEEN p_period_start AND p_period_end
    AND o.status IN ('delivered','partial_delivery','invoiced')
    AND c.ng_reportable = true
    AND NOT EXISTS (
      SELECT 1 FROM public.statistic_group_members m
      JOIN public.statistic_groups g ON g.id = m.group_id
      WHERE m.product_id = pr.id
        AND g.display_name = 'NG-sortiment'
        AND g.legal_entity_id = p_legal_entity_id
    )
  GROUP BY pr.id, pr.display_name
  ORDER BY 3 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_ng_report(uuid, date, date) FROM public;
REVOKE EXECUTE ON FUNCTION public.generate_ng_report_outside(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.generate_ng_report(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_ng_report_outside(uuid, date, date) TO authenticated;
