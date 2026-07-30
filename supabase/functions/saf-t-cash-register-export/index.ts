// SAF-T Cash Register export (Skatteetaten v1.10)
// Genererer XML fra pos_journal_events, pos_transactions/-lines, pos_sessions og pos_z_reports.
// Validerer strukturelt (well-formed + obligatoriske felter) og logger eksporten i
// pos_saf_t_exports. Filen lagres i storage-bøtta `pos-saf-t-exports` som
// <legal_entity_id>/<export_id>.xml.
//
// MERK: Dette er et utleveringsformat. Original elektronisk journal (pos_journal_events,
// pos_transactions m.fl.) skal fortsatt oppbevares i sin helhet i hele oppbevaringstiden
// jf. bokføringsloven §13.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOFTWARE_ID = "NBHub POS";
const SOFTWARE_VERSION = "1.0";
const SOFTWARE_COMPANY = "Nøtterø Bakeri Hub";
const SAF_T_VERSION = "1.10";
const SAF_T_NS = "urn:StandardAuditFile-Taxation-CashRegister:NO";

// ─── Utils ───────────────────────────────────────────────────────────────
function xmlEscape(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function el(tag: string, value: unknown, indent = ""): string {
  if (value === null || value === undefined || value === "") return "";
  return `${indent}<${tag}>${xmlEscape(value)}</${tag}>\n`;
}
function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toFixed(2);
}
function qty(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toFixed(3);
}
// Alle tidsstempler rapporteres i norsk lokaltid (Europe/Oslo), slik at
// eksporten stemmer med Z-rapportene.
const OSLO_FMT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
function osloParts(iso: string): { date: string; time: string } {
  // sv-SE gir "YYYY-MM-DD HH:mm:ss"
  const s = OSLO_FMT.format(new Date(iso)).replace(" ", "T");
  return { date: s.slice(0, 10), time: s.slice(11, 19) };
}
function osloOffset(iso: string): string {
  const d = new Date(iso);
  const local = new Date(`${osloParts(iso).date}T${osloParts(iso).time}Z`);
  const mins = Math.round((local.getTime() - d.getTime()) / 60000);
  const sign = mins >= 0 ? "+" : "-";
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
function osloTimestamp(iso: string): string {
  const p = osloParts(iso);
  return `${p.date}T${p.time}${osloOffset(iso)}`;
}
function dateOnly(iso: string): string {
  return osloParts(iso).date;
}
function timeOnly(iso: string): string {
  return osloParts(iso).time;
}

/**
 * Paginert uttrekk — PostgREST kapper stille på 1000 rader. Vi MÅ hente alt,
 * ellers signeres en ufullstendig fil som «komplett».
 */
const PAGE = 1000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPaged<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Types ───────────────────────────────────────────────────────────────
interface Body {
  legal_entity_id: string;
  terminal_id?: string | null;
  period_start: string; // ISO
  period_end: string; // ISO
}

// ─── Payment mapping ─────────────────────────────────────────────────────
// SAF-T tillater fri tekst i PaymentType, men vi holder oss til Skatteetatens anbefalte koder.
const PAYMENT_TYPE: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  vipps: "Voucher",
  invoice: "OnAccount",
  gift_card: "Voucher",
  other: "Other",
};

// ReceiptType-koder fra spec
function receiptTypeFor(txType: string, isCopy: boolean, isProforma: boolean): string {
  if (isProforma) return "Proforma";
  if (isCopy) return "Copy";
  if (txType === "return") return "Return";
  if (txType === "correction") return "Correction";
  return "Sales";
}

// Event-type mapping til SAF-T EventID/EventType (fri tekst, men vi normaliserer)
const EVENT_TYPE_LABEL: Record<string, string> = {
  drawer_open: "CashDrawerOpened",
  operator_login: "OperatorLogin",
  operator_logout: "OperatorLogout",
  session_open: "SessionOpen",
  session_close: "SessionClose",
  receipt_delivered: "ReceiptDelivered",
  receipt_copy: "ReceiptCopy",
  proforma_view: "ProformaView",
  training_mode_on: "TrainingModeOn",
  training_mode_off: "TrainingModeOff",
  z_report: "XZReport",
  cash_variance_alert: "CashVariance",
  price_change: "PriceChange",
  line_correction: "LineCorrection",
};

// ─── XML build ───────────────────────────────────────────────────────────
interface Company {
  id: string;
  name: string;
  org_number: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
}

function buildHeader(c: Company, periodStart: string, periodEnd: string): string {
  const orgNumber = (c.org_number ?? "").replace(/\s+/g, "");
  return (
    `  <Header>\n` +
    el("AuditFileVersion", SAF_T_VERSION, "    ") +
    el("AuditFileCountry", "NO", "    ") +
    el("AuditFileDateCreated", new Date().toISOString().slice(0, 10), "    ") +
    el("SoftwareCompanyName", SOFTWARE_COMPANY, "    ") +
    el("SoftwareID", SOFTWARE_ID, "    ") +
    el("SoftwareVersion", SOFTWARE_VERSION, "    ") +
    `    <Company>\n` +
    el("RegistrationNumber", orgNumber || "0", "      ") +
    el("Name", c.name, "      ") +
    `      <Address>\n` +
    el("StreetName", c.address_line1 ?? "", "        ") +
    el("AdditionalAddressDetail", c.address_line2 ?? "", "        ") +
    el("City", c.city ?? "", "        ") +
    el("PostalCode", c.postal_code ?? "", "        ") +
    el("Country", c.country ?? "NO", "        ") +
    `      </Address>\n` +
    `    </Company>\n` +
    el("DefaultCurrencyCode", "NOK", "    ") +
    `    <SelectionCriteria>\n` +
    el("SelectionStartDate", dateOnly(periodStart), "      ") +
    el("SelectionEndDate", dateOnly(periodEnd), "      ") +
    `    </SelectionCriteria>\n` +
    el(
      "HeaderComment",
      "SAF-T Kassasystem utlevering. Original elektronisk journal oppbevares i sin helhet.",
      "    ",
    ) +
    el("TaxAccountingBasis", "A", "    ") +
    `  </Header>\n`
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMasterFiles(products: any[], vatRates: number[]): string {
  const productXml = products
    .map(
      (p) =>
        `    <Product>\n` +
        el("ProductCode", p.code, "      ") +
        el("ProductGroup", p.group_name ?? "", "      ") +
        el("Description", p.name, "      ") +
        el("VATCode", `V${Math.round(Number(p.vat_rate ?? 0))}`, "      ") +
        `    </Product>\n`,
    )
    .join("");
  const taxXml = vatRates
    .map(
      (rate) =>
        `    <TaxTableEntry>\n` +
        el("TaxCode", `V${Math.round(rate)}`, "      ") +
        el("Description", `MVA ${rate}%`, "      ") +
        el("TaxPercentage", rate.toFixed(2), "      ") +
        `    </TaxTableEntry>\n`,
    )
    .join("");
  return (
    `  <MasterFiles>\n` +
    (productXml ? `    <Products>\n${productXml}    </Products>\n` : "") +
    (taxXml ? `    <TaxTable>\n${taxXml}    </TaxTable>\n` : "") +
    `  </MasterFiles>\n`
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEvent(ev: any, idx: number): string {
  const label = EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type;
  return (
    `    <Event>\n` +
    el("EventID", String(ev.id ?? idx + 1), "      ") +
    el("EventType", label, "      ") +
    el("EventDate", dateOnly(ev.event_time), "      ") +
    el("EventTime", timeOnly(ev.event_time), "      ") +
    el("OperatorID", ev.operator_id ?? "", "      ") +
    el("EventText", JSON.stringify(ev.payload ?? {}), "      ") +
    `    </Event>\n`
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTransaction(tx: any, lines: any[], idx: number): string {
  const rType = receiptTypeFor(tx.transaction_type, Boolean(tx._is_copy), Boolean(tx._is_proforma));
  const payments = (tx.payment_summary?.payments ?? []) as Array<{
    method: string;
    amount: number;
  }>;
  const linesXml = lines
    .map((l, i) => {
      const vatRate = Number(l.mva_rate ?? l.product_snapshot?.mva_rate ?? 0);
      const snap = (l.product_snapshot ?? {}) as Record<string, unknown>;
      const code = (snap.display_number as string) ?? l.product_id ?? "MISC";
      const name = (snap.display_name as string) ?? "Ukjent";
      return (
        `      <Line>\n` +
        el("Nr", String(l.line_number ?? i + 1), "        ") +
        el("LineType", tx.transaction_type === "return" ? "Return" : "Sales", "        ") +
        el("ProductCode", code, "        ") +
        el("ProductGroup", (snap.product_group as string) ?? "", "        ") +
        el("Description", name, "        ") +
        el("Quantity", qty(l.quantity), "        ") +
        el("UnitPrice", money(l.unit_price_excl_mva), "        ") +
        el("VATCode", `V${Math.round(vatRate)}`, "        ") +
        el("VATRate", vatRate.toFixed(2), "        ") +
        el("VATAmount", money(l.line_mva), "        ") +
        el("LineDiscount", money(l.line_discount ?? 0), "        ") +
        el("LineAmount", money(l.line_total_incl_mva), "        ") +
        `      </Line>\n`
      );
    })
    .join("");

  const paymentsXml = payments
    .map(
      (p, i) =>
        `      <Payment>\n` +
        el("Nr", String(i + 1), "        ") +
        el("PaymentType", PAYMENT_TYPE[p.method] ?? "Other", "        ") +
        el("Description", p.method, "        ") +
        el("Amount", money(p.amount), "        ") +
        el("CurrencyCode", "NOK", "        ") +
        `      </Payment>\n`,
    )
    .join("");

  return (
    `    <Transaction>\n` +
    el("Nr", String(idx + 1), "      ") +
    el("ReceiptNumber", tx.receipt_number ?? String(tx.id), "      ") +
    el("ReceiptType", rType, "      ") +
    el("TransactionDate", dateOnly(tx.created_at), "      ") +
    el("TransactionTime", timeOnly(tx.created_at), "      ") +
    el("TransactionType", tx.transaction_type ?? "sale", "      ") +
    el("OperatorID", tx.operator_id ?? "", "      ") +
    el("SystemEntryTime", osloTimestamp(tx.created_at), "      ") +
    el("TransactionAmountExVAT", money(tx.subtotal_excl_mva), "      ") +
    el("TransactionAmountInVAT", money(tx.total_incl_mva), "      ") +
    el("TransactionVATAmount", money(tx.total_mva), "      ") +
    linesXml +
    paymentsXml +
    `    </Transaction>\n`
  );
}

// ─── Structural validation ───────────────────────────────────────────────
// Vi kan ikke enkelt kjøre full XSD-validering i Deno-edge-runtime, så vi kjører
// en pragmatisk strukturvalidering: well-formedness + kritiske obligatoriske felter.
function validateXml(xml: string): string[] {
  const errors: string[] = [];
  // Well-formedness: enkel tag-balanse
  const openTags: string[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const full = m[0];
    const name = m[1];
    if (full.startsWith("</")) {
      const last = openTags.pop();
      if (last !== name) {
        errors.push(`Tag-mismatch: forventet </${last}> men fant </${name}>`);
        break;
      }
    } else if (!full.endsWith("/>") && !full.startsWith("<?")) {
      openTags.push(name);
    }
  }
  if (openTags.length > 0) {
    errors.push(`Uavsluttede tagger: ${openTags.join(", ")}`);
  }

  const required = [
    "AuditFile",
    "Header",
    "AuditFileVersion",
    "AuditFileCountry",
    "AuditFileDateCreated",
    "SoftwareID",
    "Company",
    "RegistrationNumber",
    "Name",
    "DefaultCurrencyCode",
    "SelectionCriteria",
    "SelectionStartDate",
    "SelectionEndDate",
    "TaxAccountingBasis",
    "CashRegister",
    "RegisterID",
  ];
  for (const t of required) {
    if (!xml.includes(`<${t}>`)) errors.push(`Mangler obligatorisk element: <${t}>`);
  }

  // Sjekk namespace
  if (!xml.includes(`xmlns="${SAF_T_NS}"`)) {
    errors.push(`Mangler SAF-T namespace: ${SAF_T_NS}`);
  }
  return errors;
}

// ─── Handler ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth: hent bruker fra Authorization header
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = (await req.json()) as Body;
    if (!body?.legal_entity_id || !body?.period_start || !body?.period_end) {
      return new Response(
        JSON.stringify({
          error: "invalid_request",
          message: "legal_entity_id, period_start og period_end er påkrevd",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Verifiser at brukeren har tilgang til selskapet
    // has_position_in_entity leser auth.uid(), så den må kalles med brukerens klient.
    const { data: hasPos, error: accessErr } = await userClient.rpc("has_position_in_entity", {
      p_legal_entity_id: body.legal_entity_id,
    });
    if (accessErr || !hasPos) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hent selskap (kolonnenavn iht. legal_entities-skjemaet)
    const { data: entityRow, error: entErr } = await admin
      .from("legal_entities")
      .select(
        "id, legal_name, display_name, org_number, invoice_address_line1, invoice_address_line2, invoice_postal_code, invoice_city, invoice_country",
      )
      .eq("id", body.legal_entity_id)
      .maybeSingle();
    const entity: Company | null = entityRow
      ? {
          id: entityRow.id,
          name: entityRow.legal_name ?? entityRow.display_name ?? "",
          org_number: entityRow.org_number,
          address_line1: entityRow.invoice_address_line1,
          address_line2: entityRow.invoice_address_line2,
          postal_code: entityRow.invoice_postal_code,
          city: entityRow.invoice_city,
          country: entityRow.invoice_country,
        }
      : null;
    if (entErr || !entity) {
      return new Response(JSON.stringify({ error: "entity_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Terminaler i scope — terminal_id MÅ tilhøre selskapet, ellers kan en
    // bruker i selskap A hente ut hele journalen til selskap B.
    let terminalIds: string[] = [];
    if (body.terminal_id) {
      const { data: term, error: termErr } = await admin
        .from("pos_terminals")
        .select("id, legal_entity_id")
        .eq("id", body.terminal_id)
        .maybeSingle();
      if (termErr) throw termErr;
      if (!term || term.legal_entity_id !== body.legal_entity_id) {
        return new Response(
          JSON.stringify({
            error: "forbidden",
            message: "Terminalen tilhører ikke valgt selskap",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      terminalIds = [term.id];
    } else {
      const { data: terms } = await admin
        .from("pos_terminals")
        .select("id")
        .eq("legal_entity_id", body.legal_entity_id);
      terminalIds = (terms ?? []).map((t) => t.id);
    }
    if (terminalIds.length === 0) {
      return new Response(JSON.stringify({ error: "no_terminals" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Opprett log-rad først (status=pending)
    const fileName = `saf-t-${entity.org_number ?? "org"}-${dateOnly(body.period_start)}_${dateOnly(
      body.period_end,
    )}.xml`;
    const { data: logRow, error: logErr } = await admin
      .from("pos_saf_t_exports")
      .insert({
        legal_entity_id: body.legal_entity_id,
        terminal_id: body.terminal_id ?? null,
        period_start: body.period_start,
        period_end: body.period_end,
        file_name: fileName,
        status: "pending",
        generated_by: userId,
      })
      .select()
      .single();
    if (logErr || !logRow) throw logErr ?? new Error("failed to create log row");
    const exportId = logRow.id as string;

    try {
      // Hent transaksjoner (paginert — PostgREST kapper stille på 1000 rader)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transactions = await fetchAllPaged<any>(() =>
        admin
          .from("pos_transactions")
          .select(
            "id, terminal_id, session_id, operator_id, receipt_number, transaction_type, subtotal_excl_mva, total_mva, total_incl_mva, payment_summary, created_at, is_training",
          )
          .in("terminal_id", terminalIds)
          .gte("created_at", body.period_start)
          .lt("created_at", body.period_end)
          .eq("is_training", false)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
      );

      const txIds = transactions.map((t) => t.id as string);
      const linesByTx = new Map<string, unknown[]>();
      // Chunk på transaksjons-id for å unngå for lange URL-er, og paginer hver chunk.
      for (let i = 0; i < txIds.length; i += 200) {
        const chunk = txIds.slice(i, i + 200);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lines = await fetchAllPaged<any>(() =>
          admin
            .from("pos_transaction_lines")
            .select(
              "id, transaction_id, line_number, product_id, product_snapshot, quantity, unit_price_excl_mva, line_discount, mva_rate, line_subtotal_excl_mva, line_mva, line_total_incl_mva",
            )
            .in("transaction_id", chunk)
            .order("transaction_id", { ascending: true })
            .order("line_number", { ascending: true }),
        );
        for (const l of lines) {
          const arr = linesByTx.get(l.transaction_id) ?? [];
          arr.push(l);
          linesByTx.set(l.transaction_id, arr);
        }
      }

      // Hent hendelser (paginert)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events = await fetchAllPaged<any>(() =>
        admin
          .from("pos_journal_events")
          .select("id, terminal_id, operator_id, event_type, event_time, payload, transaction_id")
          .in("terminal_id", terminalIds)
          .gte("event_time", body.period_start)
          .lt("event_time", body.period_end)
          .order("event_time", { ascending: true })
          .order("id", { ascending: true }),
      );

      // Kopi/proforma pr. transaksjon utledes fra journalen (ReceiptType)
      const copyTxIds = new Set<string>();
      const proformaTxIds = new Set<string>();
      for (const ev of events) {
        if (!ev.transaction_id) continue;
        if (ev.event_type === "receipt_copy") copyTxIds.add(ev.transaction_id);
        if (ev.event_type === "proforma_view") proformaTxIds.add(ev.transaction_id);
      }
      for (const tx of transactions) {
        tx._is_copy = copyTxIds.has(tx.id);
        tx._is_proforma = proformaTxIds.has(tx.id);
      }

      // Hent terminaler for metadata
      const { data: terminals } = await admin
        .from("pos_terminals")
        .select("id, terminal_code, display_name")
        .in("id", terminalIds);

      // Distinkte MVA-satser + produkt-masterdata fra linjene
      const vatSet = new Set<number>();
      const productMap = new Map<
        string,
        { code: string; name: string; vat_rate: number; group_name: string | null; product_id: string | null }
      >();
      for (const [, arr] of linesByTx) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const l of arr as any[]) {
          const snap = (l.product_snapshot ?? {}) as Record<string, unknown>;
          const r = Number(l.mva_rate ?? snap.mva_rate ?? 0);
          if (!Number.isNaN(r)) vatSet.add(r);
          const code = String(snap.display_number ?? l.product_id ?? "MISC");
          if (!productMap.has(code)) {
            productMap.set(code, {
              code,
              name: String(snap.display_name ?? "Ukjent"),
              vat_rate: r,
              group_name: null,
              product_id: (l.product_id as string) ?? null,
            });
          }
        }
      }
      // Berik med varegruppe fra products der vi har product_id
      const productIds = Array.from(productMap.values())
        .map((p) => p.product_id)
        .filter((x): x is string => !!x);
      if (productIds.length > 0) {
        for (let i = 0; i < productIds.length; i += 200) {
          const { data: prods } = await admin
            .from("products")
            .select("id, display_number, display_name, product_category")
            .in("id", productIds.slice(i, i + 200));
          const byId = new Map((prods ?? []).map((p) => [p.id, p]));
          for (const p of productMap.values()) {
            const row = p.product_id ? byId.get(p.product_id) : null;
            if (row) {
              p.group_name = row.product_category ?? null;
              if (!p.name || p.name === "Ukjent") p.name = row.display_name ?? p.name;
            }
          }
        }
      }
      const products = Array.from(productMap.values()).sort((a, b) => a.code.localeCompare(b.code));

      // Bygg XML
      const registers = (terminals ?? [])
        .map((t) => {
          const txForTerm = transactions.filter((x) => x.terminal_id === t.id);
          const evForTerm = events.filter((x) => x.terminal_id === t.id);
          const txXml = txForTerm
            .map((tx, i) =>
              buildTransaction(tx, (linesByTx.get(tx.id) ?? []) as Array<Record<string, unknown>>, i),
            )
            .join("");
          const evXml = evForTerm.map((ev, i) => buildEvent(ev, i)).join("");
          return (
            `  <CashRegister>\n` +
            el("RegisterID", t.terminal_code, "    ") +
            el("Description", t.display_name, "    ") +
            evXml +
            txXml +
            `  </CashRegister>\n`
          );
        })
        .join("");

      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<AuditFile xmlns="${SAF_T_NS}">\n` +
        buildHeader(entity, body.period_start, body.period_end) +
        buildMasterFiles(products, Array.from(vatSet).sort((a, b) => a - b)) +

        registers +
        `</AuditFile>\n`;

      // Valider
      const errors = validateXml(xml);
      if (errors.length > 0) {
        await admin
          .from("pos_saf_t_exports")
          .update({
            status: "failed",
            validation_errors: errors,
            error_message: `XML-validering feilet med ${errors.length} feil`,
            event_count: (events ?? []).length,
            transaction_count: (transactions ?? []).length,
          })
          .eq("id", exportId);
        return new Response(
          JSON.stringify({ error: "validation_failed", export_id: exportId, errors }),
          {
            status: 422,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const bytes = new TextEncoder().encode(xml);
      const hash = await sha256Hex(xml);
      const storagePath = `${body.legal_entity_id}/${exportId}.xml`;

      const { error: upErr } = await admin.storage
        .from("pos-saf-t-exports")
        .upload(storagePath, bytes, {
          contentType: "application/xml",
          upsert: true,
        });
      if (upErr) throw upErr;

      await admin
        .from("pos_saf_t_exports")
        .update({
          status: "ready",
          storage_path: storagePath,
          file_size_bytes: bytes.byteLength,
          sha256: hash,
          event_count: (events ?? []).length,
          transaction_count: (transactions ?? []).length,
        })
        .eq("id", exportId);

      // Signed URL (kort levetid)
      const { data: signed } = await admin.storage
        .from("pos-saf-t-exports")
        .createSignedUrl(storagePath, 60 * 10);

      return new Response(
        JSON.stringify({
          export_id: exportId,
          file_name: fileName,
          storage_path: storagePath,
          sha256: hash,
          file_size_bytes: bytes.byteLength,
          event_count: (events ?? []).length,
          transaction_count: (transactions ?? []).length,
          signed_url: signed?.signedUrl ?? null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from("pos_saf_t_exports")
        .update({ status: "failed", error_message: msg })
        .eq("id", exportId);
      throw e;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saf-t-export] error", msg);
    return new Response(JSON.stringify({ error: "internal", message: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
