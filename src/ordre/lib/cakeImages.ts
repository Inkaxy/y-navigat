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
  ticket_attachment_id?: string | null;
  order_id?: string | null;
  order_line_id?: string | null;
  production_department_id?: string | null;
  label_number?: string | null;
  label_unit_id?: string | null;
  resolved_label_number?: string | null;
  // Fysisk størrelse og kvalitet
  format_id?: string | null;
  shape?: string | null;
  width_mm?: number | null;
  height_mm?: number | null;
  source_width_px?: number | null;
  source_height_px?: number | null;
  effective_dpi?: number | null;
  quality_flag?: "god" | "akseptabel" | "lav" | "ukjent" | null;
  require_label_unit?: boolean;
  quality_ack_by?: string | null;
  quality_ack_at?: string | null;
  rights_cleared?: boolean | null;
  rights_note?: string | null;
  editor_state_version?: number | null;
  last_printed_by?: string | null;
};

export const CAKE_BUCKET = "cake-images";

type CakeLineCandidate = {
  id: string;
  product_id: string;
  line_number: number;
  product: {
    cake_role: string | null;
    is_cake_component: boolean;
    label_mode: string | null;
  } | null;
};

type LabelUnitCandidate = { id: string; number: number; unit_index: number | null };

export function selectFirstFreeLabelUnit(
  units: LabelUnitCandidate[],
  usedIds: Set<string>,
): LabelUnitCandidate | null {
  return (
    [...units]
      .sort(
        (a, b) =>
          (a.unit_index ?? Number.MAX_SAFE_INTEGER) -
            (b.unit_index ?? Number.MAX_SAFE_INTEGER) || a.number - b.number,
      )
      .find((unit) => !usedIds.has(unit.id)) ?? null
  );
}

export function selectCakeLine(
  rows: CakeLineCandidate[],
  usedLineIds: Set<string>,
): (CakeLineCandidate & { has_label_product: boolean }) | null {
  const labelRows = rows.filter(
    (row) => row.product?.label_mode && row.product.label_mode !== "none",
  );
  const labelRow =
    labelRows.find((row) => !usedLineIds.has(row.id)) ?? labelRows[0];
  if (labelRow) return { ...labelRow, has_label_product: true };

  const fallback =
    rows.find((row) => row.product?.cake_role === "base") ??
    rows.find((row) => row.product?.is_cake_component) ??
    rows[0];
  return fallback ? { ...fallback, has_label_product: false } : null;
}

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

/**
 * Finn etikett-enheten (label_units) som bildet hører til. Velger laveste
 * ledige nummer for ordrelinjen som ikke allerede er brukt av et annet bilde.
 */
export async function findLabelUnitForOrderLine(
  orderLineId: string,
  deliveryDate: string,
): Promise<{ id: string; number: number } | null> {
  const { data, error } = await supabase
    .from("label_units")
    .select("id, number, unit_index")
    .eq("order_line_id", orderLineId)
    .eq("seq_date", deliveryDate)
    .neq("status", "cancelled")
    .order("number", { ascending: true });
  if (error || !data || data.length === 0) return null;
  const units = data as unknown as LabelUnitCandidate[];

  const { data: taken } = await supabase
    .from("cake_images")
    .select("label_unit_id")
    .in("label_unit_id", units.map((u) => u.id));
  const used = new Set(
    ((taken ?? []) as { label_unit_id: string | null }[])
      .map((r) => r.label_unit_id)
      .filter(Boolean) as string[],
  );
  return selectFirstFreeLabelUnit(units, used);
}

export async function createCakeImage(input: {
  delivery_date: string;
  title: string;
  original_path: string;
  source?: CakeImageSource;
  customer_name?: string | null;
  ticket_id?: string | null;
  ticket_attachment_id?: string | null;
  order_id?: string | null;
  order_line_id?: string | null;
  production_department_id?: string | null;
  order_ref?: string | null;
  notes?: string | null;
  format_id?: string | null;
  shape?: string | null;
  width_mm?: number | null;
  height_mm?: number | null;
  source_width_px?: number | null;
  source_height_px?: number | null;
  effective_dpi?: number | null;
  quality_flag?: "god" | "akseptabel" | "lav" | "ukjent" | null;
}): Promise<CakeImage> {
  const { data: u } = await supabase.auth.getUser();

  // Etikettnummeret er allerede tildelt av `sync_label_numbers` når
  // bestillingen kom inn. Koble bildet til etikett-enheten og gjenbruk nummeret.
  let labelNumber: string | null = null;
  let labelUnitId: string | null = null;
  if (input.order_line_id) {
    try {
      const unit = await findLabelUnitForOrderLine(
        input.order_line_id,
        input.delivery_date,
      );
      if (unit) {
        labelUnitId = unit.id;
        labelNumber = String(unit.number);
      } else if (input.require_label_unit) {
        throw new Error("Alle etiketter på linjen har allerede bilde");
      }
    } catch (err) {
      console.warn("[cake_images] Kunne ikke koble til etikett-enhet", err);
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
      ticket_attachment_id: input.ticket_attachment_id ?? null,
      order_id: input.order_id ?? null,
      order_line_id: input.order_line_id ?? null,
      production_department_id: input.production_department_id ?? null,
      label_number: labelNumber,
      label_unit_id: labelUnitId,
      order_ref: input.order_ref ?? null,
      notes: input.notes ?? null,
      format_id: input.format_id ?? null,
      shape: input.shape ?? null,
      width_mm: input.width_mm ?? null,
      height_mm: input.height_mm ?? null,
      source_width_px: input.source_width_px ?? null,
      source_height_px: input.source_height_px ?? null,
      effective_dpi: input.effective_dpi ?? null,
      quality_flag: input.quality_flag ?? "ukjent",
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
 * med source='ticket' og `ticket_attachment_id` satt (unik indeks hindrer
 * duplikater). Ordre er valgfritt — vedlegget kan legges i kakeprint-køen
 * før henvendelsen har fått en ordre.
 */
export async function createCakeImageFromTicketAttachment(input: {
  attachment_id: string;
  file_name: string;
  ticket_id: string;
  order_id?: string | null;
  order_line_id?: string | null;
  production_department_id?: string | null;
  delivery_date: string;
  title: string;
  customer_name?: string | null;
  order_ref?: string | null;
  notes?: string | null;
  require_label_unit?: boolean;
}): Promise<CakeImage> {
  // 0) Allerede i køen? Unik indeks i basen — men vis eksisterende rad i stedet
  //    for å feile på duplikatnøkkel.
  const existing = await findCakeImageByTicketAttachment(input.attachment_id);
  if (existing) return existing;

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
    ticket_attachment_id: input.attachment_id,
    order_id: input.order_id ?? null,
    order_line_id: input.order_line_id ?? null,
    production_department_id: input.production_department_id ?? null,
    order_ref: input.order_ref ?? null,
    notes: input.notes ?? null,
    require_label_unit: input.require_label_unit,
  });
}

/** Kakebildet som allerede er laget fra et gitt ticket-vedlegg, hvis det finnes. */
export async function findCakeImageByTicketAttachment(
  attachmentId: string,
): Promise<CakeImage | null> {
  const { data, error } = await supabase
    .from("cake_images")
    .select("*")
    .eq("ticket_attachment_id", attachmentId)
    .maybeSingle();
  if (error) return null;
  return (data as CakeImage | null) ?? null;
}

/** Slår opp kakebilder for flere vedlegg samtidig (nøkkel = ticket_attachment_id). */
export async function fetchCakeImagesForAttachments(
  attachmentIds: string[],
): Promise<Record<string, CakeImage>> {
  if (attachmentIds.length === 0) return {};
  const { data, error } = await supabase
    .from("cake_images")
    .select("*")
    .in("ticket_attachment_id", attachmentIds);
  if (error) return {};
  const map: Record<string, CakeImage> = {};
  for (const row of (data ?? []) as CakeImage[]) {
    const key = (row as { ticket_attachment_id?: string | null }).ticket_attachment_id;
    if (key) map[key] = row;
  }
  return map;
}

/**
 * Når en henvendelse kobles til en ordre i etterkant: oppdater kakebilder
 * som ble laget uten ordre med ordre, ordrenummer og leveringsdato — og
 * etikett-enhet når kake-ordrelinjen er kjent.
 */
export async function attachTicketCakeImagesToOrder(input: {
  ticket_id: string;
  order_id: string;
  order_number?: string | null;
  delivery_date: string;
}): Promise<number> {
  const { data, error } = await supabase
    .from("cake_images")
    .select("id")
    .eq("ticket_id", input.ticket_id)
    .is("order_id", null);
  if (error) return 0;
  const rows = (data ?? []) as { id: string }[];
  if (rows.length === 0) return 0;

  const cakeLine = await findCakeLineForOrder(input.order_id).catch(() => null);
  let updated = 0;
  for (const row of rows) {
    const unit = cakeLine?.order_line_id
      ? await findLabelUnitForOrderLine(
          cakeLine.order_line_id,
          input.delivery_date,
        ).catch(() => null)
      : null;
    if (cakeLine?.has_label_product && !unit) {
      throw new Error("Alle etiketter på linjen har allerede bilde");
    }
    const { error: updateError } = await supabase
      .from("cake_images")
      .update({
        order_id: input.order_id,
        order_ref: input.order_number ?? null,
        delivery_date: input.delivery_date,
        order_line_id: cakeLine?.order_line_id ?? null,
        production_department_id: cakeLine?.production_department_id ?? null,
        label_unit_id: unit?.id ?? null,
        label_number: unit ? String(unit.number) : null,
      } as never)
      .eq("id", row.id);
    if (updateError) throw updateError;
    updated++;
  }
  return updated;
}



/**
 * Finn første kake-ordrelinje for ordren og tilhørende produksjonsavdeling
 * som skal brukes til etikettnummer-reservasjon. Returnerer null hvis ingen
 * passende linje/avdeling finnes.
 */
export async function findCakeLineForOrder(orderId: string): Promise<{
  order_line_id: string;
  production_department_id: string | null;
  has_label_product: boolean;
} | null> {
  const { data: lines, error: linesError } = await supabase
    .from("order_lines")
    .select("id, line_number, product_id, product:products!order_lines_product_id_fkey(id, cake_role, is_cake_component, label_mode)")
    .eq("order_id", orderId)
    .order("line_number", { ascending: true });
  if (linesError) throw linesError;
  const rows = (lines ?? []) as unknown as CakeLineCandidate[];
  const { data: linked, error: linkedError } = await supabase
    .from("cake_images")
    .select("order_line_id")
    .eq("order_id", orderId)
    .not("order_line_id", "is", null);
  if (linkedError) throw linkedError;
  const usedLineIds = new Set(
    ((linked ?? []) as { order_line_id: string | null }[])
      .map((row) => row.order_line_id)
      .filter(Boolean) as string[],
  );
  const cakeLine = selectCakeLine(rows, usedLineIds);
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
    has_label_product: cakeLine.has_label_product,
  };
}

/** Felt grensesnittet har lov til å endre på et kakebilde. */
export type CakeImagePatch = Partial<
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
    | "format_id"
    | "shape"
    | "width_mm"
    | "height_mm"
    | "source_width_px"
    | "source_height_px"
    | "effective_dpi"
    | "quality_flag"
    | "quality_ack_by"
    | "quality_ack_at"
    | "rights_cleared"
    | "rights_note"
    | "editor_state_version"
  >
>;

export async function updateCakeImage(id: string, patch: CakeImagePatch) {
  const { error } = await supabase
    .from("cake_images")
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export class CakeImageConflictError extends Error {
  constructor() {
    super("Kakebildet ble endret av noen andre");
    this.name = "CakeImageConflictError";
  }
}

/**
 * Optimistisk låsing: oppdaterer kun hvis `updated_at` fortsatt er som da
 * redaktøren lastet raden. Returnerer den oppdaterte raden (med forrige
 * edited_path fra DB, ikke lokal state).
 */
export async function updateCakeImageGuarded(
  id: string,
  expectedUpdatedAt: string,
  patch: CakeImagePatch,

): Promise<{ updated: CakeImage; previousEditedPath: string | null }> {
  // Les DB-verdien først, slik at opprydding av gammel fil bruker sannheten i DB.
  const { data: current, error: readErr } = await supabase
    .from("cake_images")
    .select("edited_path, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!current || (current as { updated_at: string }).updated_at !== expectedUpdatedAt) {
    throw new CakeImageConflictError();
  }

  const { data, error } = await supabase
    .from("cake_images")
    .update(patch as never)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select("*");
  if (error) throw error;
  const rows = (data ?? []) as CakeImage[];
  if (rows.length === 0) throw new CakeImageConflictError();
  return {
    updated: rows[0],
    previousEditedPath: (current as { edited_path: string | null }).edited_path ?? null,
  };
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

export type CakeImagePrint = {
  id: string;
  cake_image_id: string;
  printed_by: string | null;
  printed_at: string;
  kind: "print" | "reprint" | "pdf" | "test";
  sheet: string | null;
  note: string | null;
};

/** Utskriftshistorikken for ett bilde — hvem, når og hva slags utskrift. */
export async function fetchPrintHistory(cakeImageId: string) {
  const { data, error } = await supabase
    .from("cake_image_prints")
    .select("*")
    .eq("cake_image_id", cakeImageId)
    .order("printed_at", { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as unknown as CakeImagePrint[];
}

/**
 * Registrerer en utskrift. «Skrevet ut» skal bety skrevet ut: bare 'print' og
 * 'reprint' flytter status og teller — PDF-nedlasting og testark logges bare.
 * Alt skjer i én RPC, slik at to samtidige utskrifter ikke overskriver
 * hverandres teller.
 */
export async function markPrinted(
  ids: string[],
  kind: "print" | "reprint" | "pdf" | "test" = "print",
  sheet: string | null = "A4",
  note?: string | null,
  printer?: { printerLabel?: string | null; scaleAppliedPct?: number | null },
) {
  if (ids.length === 0) return [] as CakeImage[];
  const startedAt = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: rows, error } = await supabase.rpc(
    "register_cake_image_print",
    { p_ids: ids, p_kind: kind, p_sheet: sheet, p_note: note ?? null } as never,
  );
  if (error) throw error;

  // Hvilken skriver og hvilken korreksjon som faktisk ble brukt — da kan et
  // avvik i ettertid spores til utstyret og ikke bare til bildet.
  if (printer?.printerLabel || printer?.scaleAppliedPct != null) {
    const { error: upErr } = await supabase
      .from("cake_image_prints")
      .update({
        printer_label: printer.printerLabel ?? null,
        scale_applied_pct: printer.scaleAppliedPct ?? null,
      } as never)
      .in("cake_image_id", ids)
      .eq("kind", kind)
      .is("printer_label", null)
      .gte("printed_at", startedAt);
    if (upErr) console.error("[cakeImages] kunne ikke lagre skriverinfo", upErr);
  }

  const updated = (rows ?? []) as CakeImage[];
  if (kind !== "print" && kind !== "reprint") return updated;

  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id ?? null;
  const userLabel = u.user?.email ?? null;

  await Promise.all(
    updated.map(async (row) => {
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
  return updated;
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

/**
 * Koble et enkelt kakebilde til en ordre i ettertid: setter ordre, ordrenummer,
 * leveringsdato fra ordren og etikett-enhet/-nummer når kake-ordrelinjen finnes.
 */
export async function linkCakeImageToOrder(
  imageId: string,
  orderId: string,
): Promise<{
  delivery_date: string | null;
  label_number: string | null;
  warning: string | null;
}> {
  const { data: ord, error: ordErr } = await supabase
    .from("orders")
    .select("id, order_number, delivery_date")
    .eq("id", orderId)
    .maybeSingle();
  if (ordErr) throw ordErr;
  const order = ord as {
    order_number: string;
    delivery_date: string | null;
  } | null;
  if (!order) throw new Error("Fant ikke ordren");

  const cakeLine = await findCakeLineForOrder(orderId).catch(() => null);
  let labelUnitId: string | null = null;
  let labelNumber: string | null = null;
  if (cakeLine?.order_line_id && order.delivery_date) {
    const unit = await findLabelUnitForOrderLine(
      cakeLine.order_line_id,
      order.delivery_date,
    ).catch(() => null);
    if (unit) {
      labelUnitId = unit.id;
      labelNumber = String(unit.number);
    }
  }
  if (cakeLine?.has_label_product && order.delivery_date && !labelUnitId) {
    throw new Error("Alle etiketter på linjen har allerede bilde");
  }

  const patch: Record<string, unknown> = {
    order_id: orderId,
    order_ref: order.order_number,
    order_line_id: cakeLine?.order_line_id ?? null,
    production_department_id: cakeLine?.production_department_id ?? null,
    label_unit_id: labelUnitId,
    label_number: labelNumber,
  };
  if (order.delivery_date) patch.delivery_date = order.delivery_date;

  const { error } = await supabase
    .from("cake_images")
    .update(patch as never)
    .eq("id", imageId);
  if (error) throw error;

  return {
    delivery_date: order.delivery_date,
    label_number: labelNumber,
    warning: cakeLine && !cakeLine.has_label_product
      ? "Ingen etikettvare i ordren — bildet får ikke etikettnummer"
      : null,
  };
}

/**
 * Testarket fra kalibreringen logges som en utskrift med kind 'test'.
 * `cake_image_prints` krever et bilde, så testarket henges på det sist
 * oppdaterte kakebildet — det flytter ingen status, men gir sporbarhet.
 */
export async function logCalibrationTestPrint(printerLabel: string) {
  const { data } = await supabase
    .from("cake_images")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1);
  const anchorId = (data ?? [])[0]?.id as string | undefined;
  if (!anchorId) return;
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("cake_image_prints").insert({
    cake_image_id: anchorId,
    kind: "test",
    sheet: "A4",
    note: `Kalibreringsark 100 × 100 mm — ${printerLabel}`,
    printer_label: printerLabel,
    scale_applied_pct: 100,
    printed_by: u.user?.id ?? null,
  } as never);
  if (error) console.error("[cakeImages] kunne ikke logge kalibreringsark", error);
}
