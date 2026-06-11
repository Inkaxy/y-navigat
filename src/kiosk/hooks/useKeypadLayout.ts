import { useQuery } from "@tanstack/react-query";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";

export type KeypadButton = {
  id: string;
  page_id: string;
  button_type: string;
  product_id: string | null;
  function_code: string | null;
  display_label: string | null;
  image_url: string | null;
  background_color: string | null;
  text_color: string | null;
  grid_x: number;
  grid_y: number;
  grid_width: number;
  grid_height: number;
};

export type KeypadPage = {
  id: string;
  layout_id: string;
  page_name: string;
  sort_order: number;
  background_color: string | null;
  icon: string | null;
};

export type KeypadLayout = {
  id: string;
  legal_entity_id: string;
  terminal_id: string | null;
  display_name: string;
  grid_cols: number;
  grid_rows: number;
  is_default: boolean;
  theme: unknown | null;
  customer_screen: unknown | null;
};

export type KeypadData = {
  layout: KeypadLayout;
  pages: KeypadPage[];
  buttons: KeypadButton[];
} | null;

async function fetchLayout(
  terminalId: string,
  legalEntityId: string | null,
): Promise<KeypadLayout | null> {
  // a) terminal_id-binding
  const { data: byTerminal, error: e1 } = await kioskSupabase
    .from("pos_keypad_layouts")
    .select("*")
    .eq("terminal_id", terminalId)
    .limit(1);
  if (e1) throw e1;
  if (byTerminal && byTerminal[0]) return byTerminal[0] as KeypadLayout;

  // b) is_default på entity
  if (legalEntityId) {
    const { data: byDefault, error: e2 } = await kioskSupabase
      .from("pos_keypad_layouts")
      .select("*")
      .eq("legal_entity_id", legalEntityId)
      .eq("is_default", true)
      .limit(1);
    if (e2) throw e2;
    if (byDefault && byDefault[0]) return byDefault[0] as KeypadLayout;
  }

  return null;
}

export function useKeypadLayout(terminalId: string, legalEntityId: string | null) {
  return useQuery<KeypadData>({
    queryKey: ["kiosk-keypad", terminalId, legalEntityId],
    queryFn: async () => {
      const layout = await fetchLayout(terminalId, legalEntityId);
      if (!layout) return null;

      const { data: pages, error: ePages } = await kioskSupabase
        .from("pos_keypad_pages")
        .select("*")
        .eq("layout_id", layout.id)
        .order("sort_order", { ascending: true });
      if (ePages) throw ePages;

      const pageIds = (pages ?? []).map((p) => p.id);
      let buttons: KeypadButton[] = [];
      if (pageIds.length > 0) {
        const { data: btns, error: eBtns } = await kioskSupabase
          .from("pos_keypad_buttons")
          .select("*")
          .in("page_id", pageIds);
        if (eBtns) throw eBtns;
        buttons = (btns ?? []) as KeypadButton[];
      }

      return {
        layout,
        pages: (pages ?? []) as KeypadPage[],
        buttons,
      };
    },
    staleTime: 60_000,
  });
}
