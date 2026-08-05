import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "./constants";

export type CakeImageStatus = "venter" | "ferdig_redigert" | "skrevet_ut";
export type CakeImageSource = "upload" | "demo" | "email" | "ticket";

export type CakeImage = {
  id: string;
  legal_entity_id: string;
  delivery_date: string;
  title: string;
  customer_name: string | null;
  order_ref: string | null;
  notes: string | null;
  source: CakeImageSource;
  original_path: string;
  edited_path: string | null;
  editor_state: unknown | null;
  status: CakeImageStatus;
  printed_at: string | null;
  print_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  ticket_id?: string | null;
  order_id?: string | null;
  order_line_id?: string | null;
  production_department_id?: string | null;
  label_number?: string | null;
};

export const CAKE_BUCKET = "cake-images";

/** Stier organiseres som <legal_entity_id>/<dato>/<filnavn> for å matche storage-RLS. */
function buildPath(date: string, suffix: string) {
  const safe = suffix.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${NB_LEGAL_ENTITY_ID}/${date}/${crypto.randomUUID()}-${safe}`;
}

export async function signedUrl(path: string | null | undefined, expires = 60 * 10) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(CAKE_BUCKET)
    .createSignedUrl(path, expires);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function uploadOriginal(
  file: File,
  date: string,
): Promise<{ path: string; title: string }> {
  const path = buildPath(date, file.name);
  const { error } = await supabase.storage
    .from(CAKE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return { path, title: file.name.replace(/\.[^.]+$/, "") };
}

export async function uploadEditedPng(
  blob: Blob,
  date: string,
  baseName = "edited.png",
): Promise<string> {
  const path = buildPath(date, baseName);
  const { error } = await supabase.storage
    .from(CAKE_BUCKET)
    .upload(path, blob, { contentType: "image/png", upsert: false });
  if (error) throw error;
  return path;
}

export async function createCakeImage(input: {
  delivery_date: string;
  title: string;
  original_path: string;
  source?: CakeImageSource;
  customer_name?: string | null;
  ticket_id?: string | null;
  order_id?: string | null;
  order_line_id?: string | null;
  production_department_id?: string | null;
  order_ref?: string | null;
  notes?: string | null;
}): Promise<CakeImage> {
  const { data: u } = await supabase.auth.getUser();

  // Reserver etikett-nummer hvis vi har både ordrelinje og produksjonsavdeling.
  // Modifisert assign_label_number gjenbruker nummeret når etiketten skrives ut senere.
  let labelNumber: string | null = null;
  if (input.order_line_id && input.production_department_id) {
    try {
      const { data: line } = await supabase
        .from("order_lines")
        .select("product_id")
        .eq("id", input.order_line_id)
        .maybeSingle();
      const productId = (line as { product_id?: string } | null)?.product_id;
      if (productId) {
        const { data: num, error: nErr } = await supabase.rpc(
          "assign_label_number",
          {
            p_dept_id: input.production_department_id,
            p_product_id: productId,
            p_order_line_id: input.order_line_id,
            p_seq_date: input.delivery_date,
          } as never,
        );
        if (!nErr && num) labelNumber = String(num);
      }
    } catch (err) {
      console.warn("[cake_images] Kunne ikke reservere label_number", err);
    }
  }

  const { data, error } = await supabase
    .from("cake_images")
    .insert({
      legal_entity_id: NB_LEGAL_ENTITY_ID,
      delivery_date: input.delivery_date,
      title: input.title,
      original_path: input.original_path,
      source: input.source ?? "upload",
      customer_name: input.customer_name ?? null,
      ticket_id: input.ticket_id ?? null,
      order_id: input.order_id ?? null,
      order_line_id: input.order_line_id ?? null,
      production_department_id: input.production_department_id ?? null,
      label_number: labelNumber,
      order_ref: input.order_ref ?? null,
      notes: input.notes ?? null,
      created_by: u.user?.id,
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as CakeImage;
}

/**
 * Last ned ticket-vedlegg via signert URL, last opp i cake-images bucket
 * med samme sti-mønster som uploadOriginal, og opprett cake_images-rad
 * med source='ticket'. Brukes når en ordre opprettes fra en samtale.
 */
export async function createCakeImageFromTicketAttachment(input: {
  attachment_id: string;
  file_name: string;
  ticket_id: string;
  order_id: string;
  order_line_id?: string | null;
  production_department_id?: string | null;
  delivery_date: string;
  title: string;
  customer_name?: string | null;
  order_ref?: string | null;
  notes?: string | null;
}): Promise<CakeImage> {
  // 1) Hent signert URL fra edge-funksjonen
  const { data: signed, error: sErr } = await supabase.functions.invoke(
    "ticket-attachment-signed-url",
    { body: { attachment_id: input.attachment_id, inline: true } },
  );
  if (sErr) throw sErr;
  const url = (signed as { signed_url?: string } | null)?.signed_url;
  if (!url) throw new Error("Kunne ikke hente signert URL for vedlegg");

  // 2) Last ned filen
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Vedlegg kunne ikke lastes (${res.status})`);
  const blob = await res.blob();
  const contentType = blob.type || "application/octet-stream";
  const file = new File([blob], input.file_name, { type: contentType });

  // 3) Last opp til cake-images bucket
  const { path } = await uploadOriginal(file, input.delivery_date);

  // 4) Opprett cake_images-rad (label_number reserveres inne i createCakeImage)
  return await createCakeImage({
    delivery_date: input.delivery_date,
    title: input.title,
    original_path: path,
    source: "ticket",
    customer_name: input.customer_name ?? null,
    ticket_id: input.ticket_id,
    order_id: input.order_id,
    order_line_id: input.order_line_id ?? null,
    production_department_id: input.production_department_id ?? null,
    order_ref: input.order_ref ?? null,
    notes: input.notes ?? null,
  });
}

/**
 * Finn første kake-ordrelinje for ordren og tilhørende produksjonsavdeling
 * som skal brukes til etikettnummer-reservasjon. Returnerer null hvis ingen
 * passende linje/avdeling finnes.
 */
export async function findCakeLineForOrder(orderId: string): Promise<{
  order_line_id: string;
  production_department_id: string | null;
} | null> {
  const { data: lines } = await supabase
    .from("order_lines")
    .select("id, line_number, product_id, product:products!order_lines_product_id_fkey(id, cake_role, is_cake_component)")
    .eq("order_id", orderId)
    .order("line_number", { ascending: true });
  const rows = (lines ?? []) as Array<{
    id: string;
    product_id: string;
    product: { cake_role: string | null; is_cake_component: boolean } | null;
  }>;
  const cakeLine =
    rows.find((r) => r.product?.cake_role === "base") ??
    rows.find((r) => r.product?.is_cake_component) ??
    rows[0];
  if (!cakeLine) return null;
  const { data: dept } = await supabase
    .from("product_label_departments")
    .select("department_id")
    .eq("product_id", cakeLine.product_id)
    .limit(1)
    .maybeSingle();
  return {
    order_line_id: cakeLine.id,
    production_department_id:
      (dept as { department_id?: string } | null)?.department_id ?? null,
  };
}

export async function updateCakeImage(
  id: string,
  patch: Partial<
    Pick<
      CakeImage,
      | "title"
      | "customer_name"
      | "order_ref"
      | "notes"
      | "edited_path"
      | "editor_state"
      | "status"
      | "delivery_date"
    >
  >,
) {
  const { error } = await supabase
    .from("cake_images")
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCakeImage(image: CakeImage) {
  const paths = [image.original_path, image.edited_path].filter(
    Boolean,
  ) as string[];
  if (paths.length) {
    await supabase.storage.from(CAKE_BUCKET).remove(paths);
  }
  const { error } = await supabase.from("cake_images").delete().eq("id", image.id);
  if (error) throw error;
}

export async function markPrinted(ids: string[]) {
  if (ids.length === 0) return;
  // Tellingen skjer i SQL (print_count = print_count + 1) for å unngå at to
  // samtidige utskrifter overskriver hverandres teller.
  const { data: rows, error } = await supabase.rpc(
    "increment_cake_image_print",
    { p_ids: ids } as never,
  );
  if (error) throw error;
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id ?? null;
  const userLabel = u.user?.email ?? null;

  await Promise.all(
    ((rows ?? []) as CakeImage[]).map(async (row) => {
      const nextCount = row.print_count ?? 1;


      // Skriv ticket-hendelse + systeminnslag i tråden hvis raden er koblet til en ticket
      if (row.ticket_id) {
        const summary = `Kakebildet er skrevet ut (${nextCount}×) — klart for produksjon`;
        try {
          await supabase.from("ticket_events").insert({
            ticket_id: row.ticket_id,
            order_id: row.order_id ?? null,
            event_type: "cake_image.printed",
            actor_type: "staff",
            actor_user_id: userId,
            actor_label: userLabel,
            summary,
            payload: {
              cake_image_id: row.id,
              title: row.title,
              print_count: nextCount,
            } as never,
          } as never);
          await supabase.from("ticket_internal_comments").insert({
            ticket_id: row.ticket_id,
            body: `🖨️ ${summary}${row.title ? ` — «${row.title}»` : ""}`,
            mentioned_teams: [],
            author_id: userId,
            author_name: userLabel,
          } as never);
        } catch (err) {
          console.warn("[cake_images] Kunne ikke logge ticket-hendelse", err);
        }
      }
    }),
  );
}

const DEMO_SOURCES = [
  {
    title: "Bursdagskake — Emma 5 år",
    customer_name: "Familien Hansen",
    color: "#f9c5d1",
    label: "EMMA 5 ÅR",
  },
  {
    title: "Brudekake — Sundby/Lie",
    customer_name: "Anne Sundby",
    color: "#cbe7d1",
    label: "♥ Anne & Per ♥",
  },
  {
    title: "Konfirmasjon — Marius",
    customer_name: "Familien Olsen",
    color: "#d6e4ff",
    label: "GRATULERER MARIUS",
  },
];

async function svgToPng(svg: string): Promise<Blob> {
  const url = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("img load"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 750;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, 1000, 750);
  return await new Promise<Blob>((res) =>
    canvas.toBlob((b) => res(b!), "image/png"),
  );
}

export async function seedDemoImages(date: string) {
  for (const d of DEMO_SOURCES) {
    const svg = `
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 750'>
  <rect width='1000' height='750' fill='${d.color}'/>
  <circle cx='500' cy='340' r='200' fill='#fff' stroke='#1f1b16' stroke-width='6'/>
  <text x='500' y='360' text-anchor='middle' font-family='Inter,Arial' font-size='62' font-weight='800' fill='#1f1b16'>${d.label}</text>
  <text x='500' y='660' text-anchor='middle' font-family='Inter,Arial' font-size='28' fill='#4a3f33'>Demo kakebilde</text>
</svg>`.trim();
    const blob = await svgToPng(svg);
    const file = new File([blob], `${d.title}.png`, { type: "image/png" });
    const up = await uploadOriginal(file, date);
    await createCakeImage({
      delivery_date: date,
      title: d.title,
      original_path: up.path,
      source: "demo",
      customer_name: d.customer_name,
    });
  }
}

export function statusLabel(s: CakeImageStatus) {
  switch (s) {
    case "venter":
      return "Venter";
    case "ferdig_redigert":
      return "Ferdig redigert";
    case "skrevet_ut":
      return "Skrevet ut";
  }
}
