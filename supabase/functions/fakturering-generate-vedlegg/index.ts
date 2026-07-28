// fakturering-generate-vedlegg — builds the per-day delivery matrix PDF attachment for one
// invoice_basis (or all bases in a run) and uploads it to the private storage bucket
// `invoice-attachments`. NEVER touches Tripletex — the upload step happens in a later phase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BUCKET = "invoice-attachments";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Date / ISO week helpers (Europe/Oslo assumed for delivery_date; delivery_date is a plain DATE)
// ---------------------------------------------------------------------------
function parseDate(d: string): Date {
  // 'YYYY-MM-DD' → local Date at 12:00 (avoids DST edges)
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day, 12, 0, 0);
}
// Norwegian ISO week (Mon=1 … Sun=7)
function isoWeekParts(d: Date): { year: number; week: number; monday: Date; sunday: Date } {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (date.getDay() + 6) % 7; // Mon=0
  const thursday = new Date(date);
  thursday.setDate(date.getDate() - dayNum + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  const week1Monday = new Date(firstThursday);
  week1Monday.setDate(firstThursday.getDate() - firstDayNum);
  const week = Math.floor((thursday.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
  const monday = new Date(date);
  monday.setDate(date.getDate() - dayNum);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { year: thursday.getFullYear(), week, monday, sunday };
}
function isoWeekKey(d: Date) {
  const { year, week } = isoWeekParts(d);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
const NB_MONTHS = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];
function nbShortMonth(idx: number) {
  return ["jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","des"][idx];
}
function formatWeekRange(monday: Date, sunday: Date) {
  const d1 = monday.getDate();
  const d2 = sunday.getDate();
  const m1 = nbShortMonth(monday.getMonth());
  const m2 = nbShortMonth(sunday.getMonth());
  const y = sunday.getFullYear();
  if (monday.getMonth() === sunday.getMonth()) {
    return `${d1}.–${d2}. ${NB_MONTHS[sunday.getMonth()]} ${y}`;
  }
  return `${d1}. ${m1}–${d2}. ${m2} ${y}`;
}
function formatDate(d: string | Date | null) {
  if (!d) return "";
  const dt = typeof d === "string" ? parseDate(d) : d;
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
}
function formatKr(n: number) {
  const abs = Math.abs(n);
  const s = abs.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? "−" : "") + s;
}
function formatInt(n: number) {
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? "−" : "") + s;
}
function formatPrice(n: number) {
  return n.toFixed(2).replace(".", ",");
}

// ---------------------------------------------------------------------------
// PDF layout
// ---------------------------------------------------------------------------
const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN_X = 42;
const MARGIN_TOP = 42;
const MARGIN_BOTTOM = 48;

const COLORS = {
  ink: rgb(0.09, 0.09, 0.11),
  bronze: rgb(0.65, 0.48, 0.20),
  muted: rgb(0.42, 0.42, 0.44),
  line: rgb(0.85, 0.83, 0.78),
  cream: rgb(0.965, 0.945, 0.90),
  chipInk: rgb(0.13, 0.11, 0.09),
  red: rgb(0.72, 0.18, 0.14),
  white: rgb(1, 1, 1),
};

const DAY_LABELS = ["mandag","tirsdag","onsdag","torsdag","fredag","lørdag","søndag"];

interface Fonts { reg: PDFFont; bold: PDFFont; }

interface OrderLineRow {
  product_number: string;
  product_name: string;
  quantity: number;
  unit_price_excl_vat: number;
  vat_rate: number;
  line_excl_vat: number;
  is_return: boolean;
  weekday: number; // 0..6 (Mon..Sun)
}

interface CustomerWeekSection {
  customer_id: string;
  customer_name: string;
  customer_number: string;
  week_key: string;
  week_no: number;
  monday: Date;
  sunday: Date;
  // product_key → row
  productMap: Map<string, {
    product_number: string;
    product_name: string;
    vat_rate: number;
    // per weekday
    days: Array<{ qty: number; unit_price: number | null; excl: number; is_return: boolean } | null>;
    week_sum_excl: number;
  }>;
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const body = await req.json().catch(() => ({}));
    const runId = body?.run_id as string | undefined;
    const basisId = body?.basis_id as string | undefined;
    if (!runId && !basisId) return json(400, { error: "run_id or basis_id required" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Resolve legal_entity_id from the first target basis for authz.
    let entityId: string | null = null;
    if (basisId) {
      const { data } = await admin.from("invoice_basis").select("legal_entity_id").eq("id", basisId).maybeSingle();
      entityId = data?.legal_entity_id ?? null;
    } else if (runId) {
      const { data } = await admin.from("invoice_runs").select("legal_entity_id").eq("id", runId).maybeSingle();
      entityId = data?.legal_entity_id ?? null;
    }
    if (!entityId) return json(404, { error: "Fant ikke fakturagrunnlag/kjøring" });

    // User-scoped client for authz
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) return json(401, { error: "Unauthorized" });
    const userId = userData.user.id;
    const [{ data: hasWrite }, { data: hasPos }] = await Promise.all([
      userClient.rpc("has_app_write_access", { p_app_code: "faktura" }),
      userClient.rpc("has_position_in_entity", { p_legal_entity_id: entityId }),
    ]);
    if (!hasWrite || !hasPos) return json(403, { error: "Mangler tilgang til Fakturering for dette selskapet" });

    // Load target basis rows
    let basesQ = admin
      .from("invoice_basis")
      .select("id, run_id, legal_entity_id, basis_number, customer_id, sum_excl_vat, tripletex_order_number, tripletex_invoice_number")
      .eq("legal_entity_id", entityId);
    if (basisId) basesQ = basesQ.eq("id", basisId);
    else if (runId) basesQ = basesQ.eq("run_id", runId);
    const { data: bases, error: basesErr } = await basesQ;
    if (basesErr) throw basesErr;
    if (!bases || bases.length === 0) return json(200, { ok: true, generated: 0 });

    // Load entity display info once
    const { data: entity } = await admin
      .from("legal_entities")
      .select("display_name, legal_name, organization_number")
      .eq("id", entityId)
      .maybeSingle();

    // Load run dates for the involved runs
    const runIds = [...new Set(bases.map((b: any) => b.run_id))];
    const { data: runs } = await admin
      .from("invoice_runs")
      .select("id, run_date")
      .in("id", runIds);
    const runById = new Map<string, any>();
    for (const r of runs ?? []) runById.set((r as any).id, r);

    // Fonts (used across all bases; register PDFDocument per basis)
    let generated = 0;
    let errors = 0;

    for (const basis of bases as any[]) {
      try {
        // ---- Fetch orders + lines ----
        const { data: basisOrders } = await admin
          .from("invoice_basis_orders")
          .select("order_id")
          .eq("basis_id", basis.id);
        const orderIds = (basisOrders ?? []).map((r: any) => r.order_id);

        let orderRows: any[] = [];
        let orderLines: any[] = [];
        if (orderIds.length > 0) {
          const { data: oRows } = await admin
            .from("orders")
            .select("id, delivery_date, customer_id, is_return, customer_snapshot")
            .in("id", orderIds);
          orderRows = oRows ?? [];
          const { data: lRows } = await admin
            .from("order_lines")
            .select("order_id, product_snapshot, quantity, unit_price, vat_rate, line_subtotal_excl_vat")
            .in("order_id", orderIds);
          orderLines = lRows ?? [];
        }

        // ---- Load delivery customer display info ----
        const deliveryCustomerIds = [...new Set(orderRows.map((o: any) => o.customer_id).filter(Boolean))];
        const customerNameMap = new Map<string, { display_name: string; customer_number: string }>();
        if (deliveryCustomerIds.length > 0) {
          const { data: custRows } = await admin
            .from("customers")
            .select("id, display_name, customer_number")
            .in("id", deliveryCustomerIds);
          for (const c of custRows ?? []) {
            customerNameMap.set((c as any).id, {
              display_name: (c as any).display_name,
              customer_number: (c as any).customer_number,
            });
          }
        }

        // ---- Aggregate: sections keyed by (customer_id, iso-week) ----
        const sections = new Map<string, CustomerWeekSection>();
        for (const o of orderRows) {
          if (!o.delivery_date) continue;
          const d = parseDate(o.delivery_date);
          const weekday = (d.getDay() + 6) % 7; // Mon=0..Sun=6
          const { week, monday, sunday } = isoWeekParts(d);
          const weekKey = isoWeekKey(d);
          const sectionKey = `${o.customer_id}::${weekKey}`;
          let sec = sections.get(sectionKey);
          if (!sec) {
            const custInfo = customerNameMap.get(o.customer_id) ?? {
              display_name: o.customer_snapshot?.display_name ?? "Ukjent kunde",
              customer_number: o.customer_snapshot?.customer_number ?? "",
            };
            sec = {
              customer_id: o.customer_id,
              customer_name: custInfo.display_name,
              customer_number: custInfo.customer_number,
              week_key: weekKey,
              week_no: week,
              monday,
              sunday,
              productMap: new Map(),
            };
            sections.set(sectionKey, sec);
          }
          const linesForOrder = orderLines.filter((ol: any) => ol.order_id === o.id);
          for (const ln of linesForOrder) {
            const ps = ln.product_snapshot ?? {};
            const productNumber = String(ps.product_number ?? ps.varenr ?? ps.number ?? "");
            const productName = String(ps.name ?? ps.display_name ?? "Ukjent");
            const key = `${productNumber}::${productName}::${Number(ln.vat_rate)}`;
            const qtyRaw = Number(ln.quantity ?? 0);
            const qty = o.is_return ? -Math.abs(qtyRaw) : qtyRaw;
            const excl = Number(ln.line_subtotal_excl_vat ?? 0);
            const excSigned = o.is_return ? -Math.abs(excl) : excl;
            const unitPrice = Number(ln.unit_price ?? 0);
            let row = sec.productMap.get(key);
            if (!row) {
              row = {
                product_number: productNumber,
                product_name: productName,
                vat_rate: Number(ln.vat_rate),
                days: Array(7).fill(null),
                week_sum_excl: 0,
              };
              sec.productMap.set(key, row);
            }
            const existing = row.days[weekday];
            row.days[weekday] = {
              qty: (existing?.qty ?? 0) + qty,
              unit_price: unitPrice,
              excl: (existing?.excl ?? 0) + excSigned,
              is_return: (existing?.is_return || o.is_return) ?? false,
            };
            row.week_sum_excl += excSigned;
          }
        }

        // ---- Compute VAT letter mapping across all rates present ----
        const ratesSet = new Set<number>();
        for (const sec of sections.values()) {
          for (const row of sec.productMap.values()) ratesSet.add(Number(row.vat_rate));
        }
        const ratesSorted = [...ratesSet].sort((a, b) => a - b);
        const vatLetter = new Map<number, string>();
        ratesSorted.forEach((r, i) => vatLetter.set(r, String.fromCharCode(97 + i))); // a, b, c…

        // ---- Control sum ----
        let controlSum = 0;
        for (const sec of sections.values()) {
          for (const row of sec.productMap.values()) controlSum += row.week_sum_excl;
        }
        const basisTotal = Number(basis.sum_excl_vat ?? 0);
        const mismatch = Math.abs(controlSum - basisTotal) > 0.5;

        // ---- Skip when nothing to show ----
        if (sections.size === 0) {
          await admin
            .from("invoice_basis")
            .update({
              attachment_path: null,
              attachment_generated_at: new Date().toISOString(),
              attachment_error: "Ingen leveranselinjer — vedlegg ikke aktuelt",
            })
            .eq("id", basis.id);
          continue;
        }

        // ---- Build PDF ----
        const pdf = await PDFDocument.create();
        pdf.setTitle(`Vedlegg ${basis.basis_number}`);
        pdf.setAuthor("NBHub");
        const fontReg = await pdf.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
        const fonts: Fonts = { reg: fontReg, bold: fontBold };

        const runDate = runById.get(basis.run_id)?.run_date ?? null;
        const generatedAt = new Date();
        const genStamp =
          `${String(generatedAt.getDate()).padStart(2, "0")}.${String(generatedAt.getMonth() + 1).padStart(2, "0")}.${generatedAt.getFullYear()} ` +
          `${String(generatedAt.getHours()).padStart(2, "0")}:${String(generatedAt.getMinutes()).padStart(2, "0")}`;

        // Pre-sort sections by customer name then week
        const sectionsList = [...sections.values()].sort((a, b) => {
          const c = a.customer_name.localeCompare(b.customer_name, "nb");
          if (c !== 0) return c;
          return a.week_key.localeCompare(b.week_key);
        });

        // Group sections by week totals (per section VAT totals shown at the bottom of each block)
        // Page pipeline
        const headerMeta = {
          basisNumber: basis.basis_number,
          invoiceDate: runDate ? formatDate(runDate) : "",
          tripletexOrder: basis.tripletex_order_number ?? null,
          entityDisplay: entity?.display_name ?? entity?.legal_name ?? "",
          mismatch,
        };
        const beginPage = (): { page: PDFPage; y: number } => {
          const p = pdf.addPage([PAGE_W, PAGE_H]);
          const y = drawHeader(p, fonts, headerMeta);
          return { page: p, y };
        };
        let { page, y: cursorY } = beginPage();

        // Sections
        for (const sec of sectionsList) {
          const productRows = [...sec.productMap.values()].sort((a, b) => a.product_number.localeCompare(b.product_number, "nb", { numeric: true }));
          if (productRows.length === 0) continue;
          const res = drawSection(page, fonts, sec, productRows, vatLetter, cursorY, beginPage);
          page = res.page;
          cursorY = res.y;
        }

        // Finalize footers with total page count
        const totalPages = pdf.getPageCount();
        pdf.getPages().forEach((p, i) => {
          drawFooter(p, fonts, entity, genStamp, i + 1, totalPages);
        });

        const bytes = await pdf.save();
        const path = `${basis.legal_entity_id}/${basis.run_id}/${basis.basis_number}-vedlegg.pdf`;
        const { error: upErr } = await admin.storage
          .from(BUCKET)
          .upload(path, bytes, { contentType: "application/pdf", upsert: true });
        if (upErr) throw upErr;

        await admin
          .from("invoice_basis")
          .update({
            attachment_path: path,
            attachment_generated_at: new Date().toISOString(),
            attachment_error: mismatch
              ? `Kontrollsum avviker: PDF ${controlSum.toFixed(2)} vs grunnlag ${basisTotal.toFixed(2)}`
              : null,
          })
          .eq("id", basis.id);

        await admin.from("audit_log").insert({
          action: "invoice_attachment_generated",
          entity_type: "invoice_basis",
          entity_id: basis.id,
          entity_display_reference: basis.basis_number,
          legal_entity_id: basis.legal_entity_id,
          user_id: userId,
          source_app: "faktura",
          changes: { path, mismatch, control_sum: controlSum, basis_total: basisTotal },
        });
        generated++;
      } catch (e) {
        errors++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`vedlegg-gen error for basis ${basis.id}:`, msg);
        await admin
          .from("invoice_basis")
          .update({ attachment_error: msg.slice(0, 1000) })
          .eq("id", basis.id);
      }
    }

    return json(200, { ok: true, generated, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("fakturering-generate-vedlegg fatal:", msg);
    return json(500, { error: msg });
  }
});

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------
function drawText(page: PDFPage, text: string, x: number, y: number, opts: { font: PDFFont; size: number; color?: any }) {
  page.drawText(text, { x, y, size: opts.size, font: opts.font, color: opts.color ?? COLORS.ink });
}
function textWidth(font: PDFFont, text: string, size: number) {
  return font.widthOfTextAtSize(text, size);
}

function drawHeader(
  page: PDFPage,
  fonts: Fonts,
  meta: { basisNumber: string; invoiceDate: string; tripletexOrder: string | null; entityDisplay: string; mismatch: boolean },
): number {
  const topY = PAGE_H - MARGIN_TOP;
  // Left: brand
  drawText(page, "NØTTERØ BAKERI", MARGIN_X, topY, { font: fonts.bold, size: 15 });
  const brandW = textWidth(fonts.bold, "NØTTERØ BAKERI ", 15);
  drawText(page, "1898", MARGIN_X + brandW, topY, { font: fonts.bold, size: 15, color: COLORS.bronze });
  drawText(page, meta.entityDisplay.toUpperCase(), MARGIN_X, topY - 12, { font: fonts.reg, size: 7, color: COLORS.muted });

  // Right block
  const rightX = PAGE_W - MARGIN_X;
  const line1 = `VEDLEGG til fakturagrunnlag `;
  const line1w = textWidth(fonts.reg, line1, 10);
  const line1bw = textWidth(fonts.bold, meta.basisNumber, 10);
  drawText(page, line1, rightX - line1w - line1bw, topY, { font: fonts.reg, size: 10, color: COLORS.muted });
  drawText(page, meta.basisNumber, rightX - line1bw, topY, { font: fonts.bold, size: 10 });

  const line2 = `Fakturadato: ${meta.invoiceDate}${meta.tripletexOrder ? " · Tripletex-ordre " + meta.tripletexOrder : ""}`;
  const line2w = textWidth(fonts.reg, line2, 9);
  drawText(page, line2, rightX - line2w, topY - 14, { font: fonts.reg, size: 9, color: COLORS.muted });

  // Title
  const titleY = topY - 40;
  drawText(page, "Leveranser per dag", MARGIN_X, titleY, { font: fonts.bold, size: 18 });

  if (meta.mismatch) {
    drawText(page, "KONTROLLSUM AVVIKER", PAGE_W - MARGIN_X - textWidth(fonts.bold, "KONTROLLSUM AVVIKER", 10), titleY, {
      font: fonts.bold, size: 10, color: COLORS.red,
    });
  }
  return titleY - 22;
}

function estimateSectionHeight(rowCount: number): number {
  // section band + header row + rows*22 + summary rows
  return 42 + 18 + rowCount * 22 + 34;
}

function drawSection(
  page: PDFPage,
  fonts: Fonts,
  sec: CustomerWeekSection,
  productRows: Array<{
    product_number: string;
    product_name: string;
    vat_rate: number;
    days: Array<{ qty: number; unit_price: number | null; excl: number; is_return: boolean } | null>;
    week_sum_excl: number;
  }>,
  vatLetter: Map<number, string>,
  startY: number,
): number {
  let y = startY;
  const contentW = PAGE_W - 2 * MARGIN_X;

  // ---- Section band (cream) ----
  page.drawRectangle({
    x: MARGIN_X,
    y: y - 30,
    width: contentW,
    height: 30,
    color: COLORS.cream,
  });
  drawText(page, "Leveranser til: ", MARGIN_X + 12, y - 18, { font: fonts.reg, size: 10, color: COLORS.muted });
  const lblW = textWidth(fonts.reg, "Leveranser til: ", 10);
  drawText(page, sec.customer_name, MARGIN_X + 12 + lblW, y - 18, { font: fonts.bold, size: 10 });
  const nameW = textWidth(fonts.bold, sec.customer_name, 10);
  drawText(page, ` (kundenr ${sec.customer_number})`, MARGIN_X + 12 + lblW + nameW, y - 18, {
    font: fonts.reg, size: 10, color: COLORS.muted,
  });

  // Week chip (ink) right-aligned
  const chipText = `UKE ${sec.week_no} · ${formatWeekRange(sec.monday, sec.sunday)}`;
  const chipW = textWidth(fonts.bold, chipText, 9) + 18;
  const chipX = MARGIN_X + contentW - chipW - 8;
  page.drawRectangle({ x: chipX, y: y - 26, width: chipW, height: 22, color: COLORS.chipInk });
  drawText(page, chipText, chipX + 9, y - 20, { font: fonts.bold, size: 9, color: COLORS.white });

  y -= 44;

  // ---- Table column layout ----
  const nameColW = 165;
  const dayColW = (contentW - nameColW - 68) / 7; // reserve 68 for "Sum uke"
  const sumColX = MARGIN_X + nameColW + dayColW * 7;
  const sumColW = 68;

  // Header row
  drawText(page, "Varenr / navn", MARGIN_X, y, { font: fonts.reg, size: 8, color: COLORS.muted });
  for (let i = 0; i < 7; i++) {
    const label = DAY_LABELS[i];
    const cx = MARGIN_X + nameColW + i * dayColW + dayColW / 2;
    drawText(page, label, cx - textWidth(fonts.reg, label, 8) / 2, y, { font: fonts.reg, size: 8, color: COLORS.muted });
  }
  drawText(page, "Sum uke", sumColX + sumColW - textWidth(fonts.reg, "Sum uke", 8), y, {
    font: fonts.reg, size: 8, color: COLORS.muted,
  });
  y -= 6;
  page.drawLine({
    start: { x: MARGIN_X, y }, end: { x: MARGIN_X + contentW, y },
    thickness: 0.5, color: COLORS.line,
  });
  y -= 12;

  // Rows (rely on estimateSectionHeight for pagination outside; if we still run out, break cleanly)
  for (const row of productRows) {
    if (y < MARGIN_BOTTOM + 60) break;
    // Varenr + name (bold), vat marker under
    drawText(page, `${row.product_number} ${row.product_name}`, MARGIN_X, y, {
      font: fonts.bold, size: 9.5,
    });
    const letter = vatLetter.get(Number(row.vat_rate)) ?? "";
    const hasReturn = row.days.some((d) => d && d.qty < 0);
    const subline = `(${letter})${hasReturn ? " · retur" : ""}`;
    drawText(page, subline, MARGIN_X, y - 10, { font: fonts.reg, size: 8, color: COLORS.muted });

    // Day cells
    for (let i = 0; i < 7; i++) {
      const cell = row.days[i];
      if (!cell) continue;
      const cx = MARGIN_X + nameColW + i * dayColW + dayColW / 2;
      const qtyStr = formatInt(cell.qty);
      const qtyColor = cell.qty < 0 ? COLORS.red : COLORS.ink;
      drawText(page, qtyStr, cx - textWidth(fonts.bold, qtyStr, 10) / 2, y, {
        font: fonts.bold, size: 10, color: qtyColor,
      });
      if (cell.unit_price != null) {
        const pStr = formatPrice(cell.unit_price);
        drawText(page, pStr, cx - textWidth(fonts.reg, pStr, 8) / 2, y - 10, {
          font: fonts.reg, size: 8, color: COLORS.muted,
        });
      }
      if (cell.qty < 0) {
        const rt = "RETUR";
        drawText(page, rt, cx - textWidth(fonts.bold, rt, 6.5) / 2, y - 19, {
          font: fonts.bold, size: 6.5, color: COLORS.red,
        });
      }
    }

    // Sum uke right-aligned
    const sumStr = formatKr(row.week_sum_excl);
    const sumColor = row.week_sum_excl < 0 ? COLORS.red : COLORS.ink;
    drawText(page, sumStr, sumColX + sumColW - textWidth(fonts.bold, sumStr, 10), y, {
      font: fonts.bold, size: 10, color: sumColor,
    });

    y -= 26;
    page.drawLine({
      start: { x: MARGIN_X, y: y + 6 }, end: { x: MARGIN_X + contentW, y: y + 6 },
      thickness: 0.3, color: COLORS.line,
    });
  }

  // ---- Week total row ----
  // Aggregate by vat rate for the "herav" text
  const byRate = new Map<number, number>();
  let total = 0;
  for (const row of productRows) {
    byRate.set(Number(row.vat_rate), (byRate.get(Number(row.vat_rate)) ?? 0) + row.week_sum_excl);
    total += row.week_sum_excl;
  }
  page.drawLine({
    start: { x: MARGIN_X, y: y + 8 }, end: { x: MARGIN_X + contentW, y: y + 8 },
    thickness: 1.2, color: COLORS.ink,
  });
  y -= 2;
  drawText(page, `Sum uke ${sec.week_no}`, MARGIN_X, y, { font: fonts.bold, size: 10 });

  const heravParts: string[] = [];
  for (const [rate, sum] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) {
    const letter = vatLetter.get(rate) ?? "";
    heravParts.push(`(${letter}) ${rate} %: ${formatKr(sum)}`);
  }
  const heravText = "herav " + heravParts.join("  ·  ");
  const heravW = textWidth(fonts.reg, heravText, 9);
  const totalStr = formatKr(total);
  const totalW = textWidth(fonts.bold, totalStr, 10);
  drawText(page, heravText, sumColX + sumColW - totalW - 12 - heravW, y, {
    font: fonts.reg, size: 9, color: COLORS.muted,
  });
  drawText(page, totalStr, sumColX + sumColW - totalW, y, {
    font: fonts.bold, size: 10, color: total < 0 ? COLORS.red : COLORS.ink,
  });
  y -= 16;

  // Legend
  const legendParts: string[] = [];
  for (const [rate, letter] of [...vatLetter.entries()].sort((a, b) => a[0] - b[0])) {
    legendParts.push(`(${letter}) = ${rate} % mva`);
  }
  legendParts.push("RETUR = negativ mengde krediteres");
  drawText(page, legendParts.join("    "), MARGIN_X, y, { font: fonts.reg, size: 8, color: COLORS.muted });
  y -= 20;

  return y;
}

function drawFooter(page: PDFPage, fonts: Fonts, entity: any, genStamp: string, pageIdx: number, totalPages: number) {
  const y = 26;
  const left = `${entity?.legal_name ?? ""} ${entity?.organization_number ? "· org " + entity.organization_number + " MVA" : ""}`.trim();
  const mid = `Generert av NBHub ${genStamp}`;
  const right = `Vedlegg side ${pageIdx || 1} av ${totalPages || 1}`;

  drawText(page, left, MARGIN_X, y, { font: fonts.reg, size: 7.5, color: COLORS.muted });
  const midW = textWidth(fonts.reg, mid, 7.5);
  drawText(page, mid, (PAGE_W - midW) / 2, y, { font: fonts.reg, size: 7.5, color: COLORS.muted });
  const rightW = textWidth(fonts.reg, right, 7.5);
  drawText(page, right, PAGE_W - MARGIN_X - rightW, y, { font: fonts.reg, size: 7.5, color: COLORS.muted });

  page.drawLine({
    start: { x: MARGIN_X, y: y + 12 }, end: { x: PAGE_W - MARGIN_X, y: y + 12 },
    thickness: 0.3, color: COLORS.line,
  });
}
