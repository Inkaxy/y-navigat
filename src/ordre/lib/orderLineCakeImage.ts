import { supabase } from "@/integrations/supabase/client";
import {
  CAKE_BUCKET,
  findLabelUnitForOrderLine,
  uploadOriginal,
  type CakeImage,
} from "./cakeImages";

/** Nøkkel i `merknad` der stien til et opplastet, ennå ikke koblet, kakebilde lagres. */
export const PENDING_CAKE_IMAGE_KEY = "pending_cake_image_path";

/** Last opp fil til `cake-images` med standard sti `{selskap}/{dato}/{uuid}-{filnavn}`. */
export async function uploadCakeImageFile(file: File, deliveryDate: string) {
  return await uploadOriginal(file, deliveryDate);
}

/**
 * Koble et opplastet bilde til en eksisterende ordrelinje. RPC-en utleder
 * leveringsdato, kunde, ordrenummer og selskap fra ordren, og erstatter et
 * eventuelt eksisterende bilde for samme linje.
 */
export async function attachCakeImageToOrderLine(
  orderLineId: string,
  originalPath: string,
  title?: string | null,
  notes?: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc("upload_cake_image_for_order_line", {
    p_order_line_id: orderLineId,
    p_original_path: originalPath,
    ...(title ? { p_title: title } : {}),
    ...(notes ? { p_notes: notes } : {}),
  });
  if (error) throw error;
  const imageId = data as string;

  // Koble bildet til etikett-enheten slik at det deler nummer med etiketten.
  try {
    const row = await fetchCakeImageForLine(orderLineId);
    if (row && !row.label_unit_id) {
      const unit = await findLabelUnitForOrderLine(orderLineId, row.delivery_date);
      if (unit) {
        await supabase
          .from("cake_images")
          .update({
            label_unit_id: unit.id,
            label_number: String(unit.number),
          } as never)
          .eq("id", row.id);
      } else {
        throw new Error("Alle etiketter på linjen har allerede bilde");
      }
    }
  } catch (err) {
    console.warn("[cake_images] Kunne ikke koble bilde til etikett-enhet", err);
  }

  return imageId;
}

export async function fetchCakeImageForLine(
  orderLineId: string,
): Promise<CakeImage | null> {
  const { data, error } = await supabase
    .from("cake_images")
    .select("*")
    .eq("order_line_id", orderLineId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as CakeImage | null) ?? null;
}

/** Slett kakebildet for en ordrelinje. Skrevet ut ⇒ ikke lov. */
export async function removeCakeImageForLine(orderLineId: string): Promise<void> {
  const row = await fetchCakeImageForLine(orderLineId);
  if (!row) return;
  if (row.status === "skrevet_ut") {
    throw new Error("Kakebildet er allerede skrevet ut og kan ikke fjernes");
  }
  const paths = [row.original_path, row.edited_path].filter(Boolean) as string[];
  if (paths.length) await supabase.storage.from(CAKE_BUCKET).remove(paths);
  const { error } = await supabase.from("cake_images").delete().eq("id", row.id);
  if (error) throw error;
}

/**
 * Etter at en ordre er lagret: kall RPC-en for hver linje som har
 * `merknad.pending_cake_image_path`, og fjern nøkkelen fra merknaden.
 * Kaster aldri — returnerer antall vellykkede/feilede.
 */
export async function flushPendingCakeImages(
  orderId: string,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  const { data, error } = await supabase
    .from("order_lines")
    .select("id, merknad, product_snapshot")
    .eq("order_id", orderId);
  if (error) return { ok, failed };

  const rows = (data ?? []) as Array<{
    id: string;
    merknad: Record<string, unknown> | null;
    product_snapshot: Record<string, unknown> | null;
  }>;

  for (const row of rows) {
    const path = row.merknad?.[PENDING_CAKE_IMAGE_KEY];
    if (typeof path !== "string" || !path) continue;
    const title =
      (row.product_snapshot?.display_name as string | undefined) ?? null;
    try {
      await attachCakeImageToOrderLine(row.id, path, title);
      const nextMerknad = { ...(row.merknad ?? {}) };
      delete nextMerknad[PENDING_CAKE_IMAGE_KEY];
      await supabase
        .from("order_lines")
        .update({ merknad: nextMerknad as never })
        .eq("id", row.id);
      ok++;
    } catch (err) {
      console.warn("[cake_images] Kunne ikke koble kakebilde til linje", row.id, err);
      failed++;
    }
  }
  return { ok, failed };
}
