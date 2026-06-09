DROP POLICY products_select_in_entity ON public.products;
CREATE POLICY products_select_in_entity ON public.products
  FOR SELECT TO authenticated
  USING (has_position_in_entity(legal_entity_id) OR is_platform_admin() OR is_kiosk_user());

DROP POLICY pli_select_in_entity ON public.price_list_items;
CREATE POLICY pli_select_in_entity ON public.price_list_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.price_lists pl
    WHERE pl.id = price_list_items.price_list_id
      AND (has_position_in_entity(pl.legal_entity_id)
           OR is_platform_admin()
           OR is_kiosk_user())
  ));

DROP POLICY price_lists_select_in_entity ON public.price_lists;
CREATE POLICY price_lists_select_in_entity ON public.price_lists
  FOR SELECT TO authenticated
  USING (has_position_in_entity(legal_entity_id) OR is_platform_admin() OR is_kiosk_user());