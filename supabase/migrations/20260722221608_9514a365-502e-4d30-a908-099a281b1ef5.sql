
-- 1) Legg selskap-tilknytning på kiosk-brukere
ALTER TABLE public.pos_kiosk_users
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.legal_entities(id);

-- 2) Ny helper: kiosk-bruker bundet til et bestemt selskap
CREATE OR REPLACE FUNCTION public.is_kiosk_user_in_entity(p_entity uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pos_kiosk_users
    WHERE user_id = auth.uid()
      AND legal_entity_id IS NOT NULL
      AND legal_entity_id = p_entity
  );
$$;

-- 3) Erstatt policies som brukte is_kiosk_user() uten entity-scoping

-- products
DROP POLICY IF EXISTS products_select_in_entity ON public.products;
CREATE POLICY products_select_in_entity ON public.products
  FOR SELECT USING (
    has_position_in_entity(legal_entity_id)
    OR is_platform_admin()
    OR is_kiosk_user_in_entity(legal_entity_id)
  );

-- price_lists
DROP POLICY IF EXISTS price_lists_select_in_entity ON public.price_lists;
CREATE POLICY price_lists_select_in_entity ON public.price_lists
  FOR SELECT USING (
    has_position_in_entity(legal_entity_id)
    OR is_platform_admin()
    OR is_kiosk_user_in_entity(legal_entity_id)
  );

-- price_list_items
DROP POLICY IF EXISTS pli_select_in_entity ON public.price_list_items;
CREATE POLICY pli_select_in_entity ON public.price_list_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.price_lists pl
      WHERE pl.id = price_list_items.price_list_id
        AND (
          has_position_in_entity(pl.legal_entity_id)
          OR is_platform_admin()
          OR is_kiosk_user_in_entity(pl.legal_entity_id)
        )
    )
  );

-- pos_terminals
DROP POLICY IF EXISTS pos_terminals_select ON public.pos_terminals;
CREATE POLICY pos_terminals_select ON public.pos_terminals
  FOR SELECT USING (
    has_position_in_entity(legal_entity_id)
    OR is_platform_admin()
    OR is_kiosk_user_in_entity(legal_entity_id)
  );

-- pos_printers
DROP POLICY IF EXISTS pos_printers_select ON public.pos_printers;
CREATE POLICY pos_printers_select ON public.pos_printers
  FOR SELECT USING (
    has_position_in_entity(legal_entity_id)
    OR is_platform_admin()
    OR is_kiosk_user_in_entity(legal_entity_id)
  );

-- pos_print_stations
DROP POLICY IF EXISTS pos_print_stations_select ON public.pos_print_stations;
CREATE POLICY pos_print_stations_select ON public.pos_print_stations
  FOR SELECT USING (
    has_position_in_entity(legal_entity_id)
    OR is_platform_admin()
    OR is_kiosk_user_in_entity(legal_entity_id)
  );

-- pos_terminal_printers
DROP POLICY IF EXISTS pos_terminal_printers_select ON public.pos_terminal_printers;
CREATE POLICY pos_terminal_printers_select ON public.pos_terminal_printers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pos_terminals t
      WHERE t.id = pos_terminal_printers.terminal_id
        AND (
          has_position_in_entity(t.legal_entity_id)
          OR is_platform_admin()
          OR is_kiosk_user_in_entity(t.legal_entity_id)
        )
    )
  );

-- pos_print_jobs (select)
DROP POLICY IF EXISTS pos_print_jobs_select ON public.pos_print_jobs;
CREATE POLICY pos_print_jobs_select ON public.pos_print_jobs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pos_printers p
      WHERE p.id = pos_print_jobs.printer_id
        AND (
          has_position_in_entity(p.legal_entity_id)
          OR is_platform_admin()
          OR is_kiosk_user_in_entity(p.legal_entity_id)
        )
    )
  );

-- pos_print_jobs (update) — kiosk får kun oppdatere jobber i egen entity
DROP POLICY IF EXISTS pos_print_jobs_update ON public.pos_print_jobs;
CREATE POLICY pos_print_jobs_update ON public.pos_print_jobs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.pos_printers p
      WHERE p.id = pos_print_jobs.printer_id
        AND (
          (has_position_in_entity(p.legal_entity_id) AND has_app_write_access('pos_styring'))
          OR is_platform_admin()
          OR (is_kiosk_user_in_entity(p.legal_entity_id) AND status = ANY (ARRAY['queued','printing']))
        )
    )
  );

-- pos_keypad_layouts
DROP POLICY IF EXISTS pos_keypad_layouts_select ON public.pos_keypad_layouts;
CREATE POLICY pos_keypad_layouts_select ON public.pos_keypad_layouts
  FOR SELECT USING (
    has_position_in_entity(legal_entity_id)
    OR is_platform_admin()
    OR is_kiosk_user_in_entity(legal_entity_id)
  );

-- pos_keypad_pages
DROP POLICY IF EXISTS pos_keypad_pages_select ON public.pos_keypad_pages;
CREATE POLICY pos_keypad_pages_select ON public.pos_keypad_pages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pos_keypad_layouts l
      WHERE l.id = pos_keypad_pages.layout_id
        AND (
          has_position_in_entity(l.legal_entity_id)
          OR is_platform_admin()
          OR is_kiosk_user_in_entity(l.legal_entity_id)
        )
    )
  );

-- pos_keypad_buttons
DROP POLICY IF EXISTS pos_keypad_buttons_select ON public.pos_keypad_buttons;
CREATE POLICY pos_keypad_buttons_select ON public.pos_keypad_buttons
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.pos_keypad_pages pg
      JOIN public.pos_keypad_layouts l ON l.id = pg.layout_id
      WHERE pg.id = pos_keypad_buttons.page_id
        AND (
          has_position_in_entity(l.legal_entity_id)
          OR is_platform_admin()
          OR is_kiosk_user_in_entity(l.legal_entity_id)
        )
    )
  );

-- pos_sessions
DROP POLICY IF EXISTS pos_sessions_select ON public.pos_sessions;
CREATE POLICY pos_sessions_select ON public.pos_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pos_terminals t
      WHERE t.id = pos_sessions.terminal_id
        AND (
          has_position_in_entity(t.legal_entity_id)
          OR is_platform_admin()
          OR is_kiosk_user_in_entity(t.legal_entity_id)
        )
    )
  );

-- pos_transactions
DROP POLICY IF EXISTS pos_transactions_select ON public.pos_transactions;
CREATE POLICY pos_transactions_select ON public.pos_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pos_terminals t
      WHERE t.id = pos_transactions.terminal_id
        AND (
          has_position_in_entity(t.legal_entity_id)
          OR is_platform_admin()
          OR is_kiosk_user_in_entity(t.legal_entity_id)
        )
    )
  );

-- pos_transaction_lines
DROP POLICY IF EXISTS pos_tx_lines_select ON public.pos_transaction_lines;
CREATE POLICY pos_tx_lines_select ON public.pos_transaction_lines
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.pos_transactions tx
      JOIN public.pos_terminals t ON t.id = tx.terminal_id
      WHERE tx.id = pos_transaction_lines.transaction_id
        AND (
          has_position_in_entity(t.legal_entity_id)
          OR is_platform_admin()
          OR is_kiosk_user_in_entity(t.legal_entity_id)
        )
    )
  );

-- pos_journal_events
DROP POLICY IF EXISTS pos_journal_select ON public.pos_journal_events;
CREATE POLICY pos_journal_select ON public.pos_journal_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pos_terminals t
      WHERE t.id = pos_journal_events.terminal_id
        AND (
          has_position_in_entity(t.legal_entity_id)
          OR is_platform_admin()
          OR is_kiosk_user_in_entity(t.legal_entity_id)
        )
    )
  );

-- pos_operator_terminals
DROP POLICY IF EXISTS pos_op_term_select ON public.pos_operator_terminals;
CREATE POLICY pos_op_term_select ON public.pos_operator_terminals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.pos_operators o
      WHERE o.id = pos_operator_terminals.operator_id
        AND (
          has_position_in_entity(o.legal_entity_id)
          OR is_platform_admin()
          OR is_kiosk_user_in_entity(o.legal_entity_id)
        )
    )
  );

-- pos_operators
DROP POLICY IF EXISTS pos_operators_select ON public.pos_operators;
CREATE POLICY pos_operators_select ON public.pos_operators
  FOR SELECT USING (
    is_platform_admin()
    OR (has_position_in_entity(legal_entity_id) AND app_access_level('pos_styring') <> 'none'::access_level)
    OR is_kiosk_user_in_entity(legal_entity_id)
  );

-- pos_product_images
DROP POLICY IF EXISTS pos_product_images_select ON public.pos_product_images;
CREATE POLICY pos_product_images_select ON public.pos_product_images
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = pos_product_images.product_id
        AND (
          has_position_in_entity(p.legal_entity_id)
          OR is_kiosk_user_in_entity(p.legal_entity_id)
        )
    )
  );

-- cake_categories — kiosk skal kun se egne aktive kategorier
DROP POLICY IF EXISTS cake_cat_kiosk_select ON public.cake_categories;
CREATE POLICY cake_cat_kiosk_select ON public.cake_categories
  FOR SELECT USING (
    is_kiosk_user_in_entity(legal_entity_id) AND status = 'active'
  );
