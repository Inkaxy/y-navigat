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
  image_storage_path: string | null;
  show_image: boolean | null;
  background_color: string | null;
  text_color: string | null;
  grid_x: number;
  grid_y: number;
  grid_width: number;
  grid_height: number;
  target_page_id: string | null;
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
  show_product_image: boolean;
  theme: unknown | null;
  customer_screen: unknown | null;
};

export type KeypadData = {
  layout: KeypadLayout;
  pages: KeypadPage[];
  buttons: KeypadButton[];
  /** Map fra storage_path → signert URL for produktbilder. */
  imageUrls: Record<string, string>;
  /** Map fra product_id → primær storage_path (fra pos_product_images). */
  productPrimaryPaths: Record<string, string>;
  /** Map fra product_id → arvet image_url fra products (public bucket). */
  productFallbackUrls: Record<string, string>;
  /** Map fra function_code → storage_path for sentralt opplastede funksjonsbilder. */
  functionImagePaths: Record<string, string>;
} | null;

const PRODUCT_IMAGE_BUCKET = "pos-product-images";

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

async function signImageUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await kioskSupabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .createSignedUrls(paths, 3600);
  if (error) {
    console.warn("[keypad] kunne ikke signere produktbilder", error);
    return {};
  }
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  }
  return out;
}

async function fetchProductPrimaryPaths(
  productIds: string[],
): Promise<Record<string, string>> {
  if (productIds.length === 0) return {};
  const { data, error } = await kioskSupabase
    .from("pos_product_images")
    .select("product_id, storage_path, is_primary")
    .in("product_id", productIds)
    .eq("is_primary", true);
  if (error) {
    console.warn("[keypad] kunne ikke hente produktbilder", error);
    return {};
  }
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.product_id && row.storage_path) out[row.product_id] = row.storage_path;
  }
  return out;
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

      const productIds = Array.from(
        new Set(
          buttons
            .filter((b) => b.button_type === "product")
            .map((b) => b.product_id)
            .filter((p): p is string => !!p),
        ),
      );
      const productPrimaryPaths = await fetchProductPrimaryPaths(productIds);

      const productFallbackUrls: Record<string, string> = {};
      const missingFallbackIds = productIds.filter((id) => !productPrimaryPaths[id]);
      if (missingFallbackIds.length > 0) {
        const { data: prodRows, error: eProd } = await kioskSupabase
          .from("products")
          .select("id, image_url")
          .in("id", missingFallbackIds);
        if (eProd) {
          console.warn("[keypad] kunne ikke hente arvet image_url fra products", eProd);
        }
        for (const row of prodRows ?? []) {
          if (row.id && row.image_url) productFallbackUrls[row.id] = row.image_url;
        }
      }

      const paths = Array.from(
        new Set([
          ...buttons
            .map((b) => b.image_storage_path)
            .filter((p): p is string => !!p),
          ...Object.values(productPrimaryPaths),
        ]),
      );
      const imageUrls = await signImageUrls(paths);

      return {
        layout: layout as KeypadLayout,
        pages: (pages ?? []) as KeypadPage[],
        buttons,
        imageUrls,
        productPrimaryPaths,
        productFallbackUrls,
      };
    },
    staleTime: 50 * 60 * 1000,
    refetchInterval: 50 * 60 * 1000,
  });
}
