DROP POLICY IF EXISTS rm_insert ON public.raw_materials;
CREATE POLICY rm_insert ON public.raw_materials FOR INSERT TO authenticated
WITH CHECK (public.has_ravarer_access((SELECT auth.uid()), legal_entity_id, 'write'::access_level));

DROP POLICY IF EXISTS rm_update ON public.raw_materials;
CREATE POLICY rm_update ON public.raw_materials FOR UPDATE TO authenticated
USING (public.has_ravarer_access((SELECT auth.uid()), legal_entity_id, 'write'::access_level))
WITH CHECK (public.has_ravarer_access((SELECT auth.uid()), legal_entity_id, 'write'::access_level));

DROP POLICY IF EXISTS rm_delete ON public.raw_materials;
CREATE POLICY rm_delete ON public.raw_materials FOR DELETE TO authenticated
USING (public.has_ravarer_access((SELECT auth.uid()), legal_entity_id, 'admin'::access_level));

DROP POLICY IF EXISTS suppliers_insert ON public.suppliers;
CREATE POLICY suppliers_insert ON public.suppliers FOR INSERT TO authenticated
WITH CHECK (public.has_ravarer_access((SELECT auth.uid()), legal_entity_id, 'write'::access_level));

DROP POLICY IF EXISTS suppliers_update ON public.suppliers;
CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE TO authenticated
USING (public.has_ravarer_access((SELECT auth.uid()), legal_entity_id, 'write'::access_level))
WITH CHECK (public.has_ravarer_access((SELECT auth.uid()), legal_entity_id, 'write'::access_level));

DROP POLICY IF EXISTS suppliers_delete ON public.suppliers;
CREATE POLICY suppliers_delete ON public.suppliers FOR DELETE TO authenticated
USING (public.has_ravarer_access((SELECT auth.uid()), legal_entity_id, 'admin'::access_level));