import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import {
  CAKE_BUCKET,
  fetchCakeLineDetails,
  type CakeImage,
} from "@/ordre/lib/cakeImages";
import type { CakeImageFormat } from "@/ordre/lib/cakeFormats";
import { itemToPrint, type CakePrintItem } from "@/ordre/lib/cakePrint";
import { withResolvedLabelNumbers } from "@/ordre/lib/labelNumber";

/**
 * Alt et ark trenger, hentet i ett jafs: bildet, signert URL, formatet,
 * etikettnummeret og linjeteksten. Både listen og utskriftssiden bruker
 * denne — da blir papiret likt uansett hvor man trykker.
 */
export async function loadCakePrintItems(ids: string[]): Promise<{
  items: CakePrintItem[];
  images: CakeImage[];
}> {
  if (ids.length === 0) return { items: [], images: [] };

  const [imagesRes, formatsRes] = await Promise.all([
    supabase.from("cake_images").select("*").in("id", ids),
    supabase
      .from("cake_image_formats")
      .select("*")
      .eq("legal_entity_id", NB_LEGAL_ENTITY_ID),
  ]);
  if (imagesRes.error) throw imagesRes.error;
  if (formatsRes.error) throw formatsRes.error;

  const images = await withResolvedLabelNumbers(
    (imagesRes.data ?? []) as CakeImage[],
  );
  const formats = (formatsRes.data ?? []) as unknown as CakeImageFormat[];

  const paths = images.map((r) => r.edited_path || r.original_path).filter(Boolean);
  const [{ data: signed }, lineDetails] = await Promise.all([
    supabase.storage.from(CAKE_BUCKET).createSignedUrls(paths, 60 * 30),
    fetchCakeLineDetails(images.map((r) => r.order_line_id)),
  ]);
  const urlByPath = Object.fromEntries(
    (signed ?? []).map((s) => [s.path ?? "", s.signedUrl ?? ""]),
  );

  const items = images.map((image) => {
    const details = image.order_line_id ? lineDetails[image.order_line_id] : undefined;
    return itemToPrint(
      image,
      urlByPath[image.edited_path || image.original_path] ?? "",
      formats.find((f) => f.id === image.format_id) ?? null,
      { productName: details?.productName, cakeText: details?.cakeText },
    );
  });

  return { items, images };
}
