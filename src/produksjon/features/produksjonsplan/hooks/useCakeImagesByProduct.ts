import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CAKE_BUCKET } from "@/ordre/lib/cakeImages";

export type CakeImageThumb = {
  id: string;
  label_number: string | null;
  status: string;
  url: string | null;
  product_id: string | null;
};

/**
 * Kakebilder for en leveringsdag, gruppert per produkt. Brukes i
 * produksjonsplanen slik at bakeren ser bildet på varelinja — ikke bare et
 * varenummer.
 */
export function useCakeImagesByProduct(date: string | undefined) {
  return useQuery({
    enabled: !!date,
    queryKey: ["cake-images", "by-product", date],
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Record<string, CakeImageThumb[]>> => {
      const { data, error } = await supabase
        .from("cake_images")
        .select(
          "id, label_number, status, edited_path, original_path, order_line_id, order_lines(product_id)",
        )
        .eq("delivery_date", date!);
      if (error) throw error;
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const paths = rows
        .map((r) => (r.edited_path as string) || (r.original_path as string))
        .filter(Boolean);
      const { data: signed } = paths.length
        ? await supabase.storage.from(CAKE_BUCKET).createSignedUrls(paths, 60 * 20)
        : { data: [] as Array<{ path: string | null; signedUrl: string | null }> };
      const urlMap = Object.fromEntries(
        (signed ?? []).map((s) => [s.path ?? "", s.signedUrl ?? ""]),
      );

      const map: Record<string, CakeImageThumb[]> = {};
      for (const r of rows) {
        const productId =
          (r.order_lines as { product_id?: string } | null)?.product_id ?? null;
        if (!productId) continue;
        const path = (r.edited_path as string) || (r.original_path as string);
        (map[productId] ||= []).push({
          id: r.id as string,
          label_number: (r.label_number as string) ?? null,
          status: (r.status as string) ?? "venter",
          url: urlMap[path] ?? null,
          product_id: productId,
        });
      }
      for (const list of Object.values(map)) {
        list.sort((a, b) => (a.label_number ?? "").localeCompare(b.label_number ?? ""));
      }
      return map;
    },
  });
}
