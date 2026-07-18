import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BigButton } from "./BigButton";
import {
  parseMvaBreakdown,
  parsePaymentSummary,
  parseProductSnapshot,
} from "@/pos_styring/lib/pos-types";
import type {
  ReceiptCompany,
  ReceiptOutlet,
} from "@/kiosk/hooks/useReceiptHeader";

interface TxRow {
  id: string;
  receipt_number: string | null;
  receipt_sequence: number | null;
  created_at: string;
  dining_mode: string;
  subtotal_excl_mva: number;
  total_mva: number;
  total_incl_mva: number;
  mva_breakdown: unknown;
  payment_summary: unknown;
  transaction_type?: string;
  reference_transaction_id?: string | null;
}

interface LineRow {
  id: string;
  line_number: number;
  product_snapshot: unknown;
  quantity: number;
  unit_price_excl_mva: number;
  line_discount: number;
  mva_rate: number;
  line_subtotal_excl_mva: number;
  line_mva: number;
  line_total_incl_mva: number;
}

export type ReceiptVariant = "sale" | "return" | "proforma" | "copy";

interface Props {
  open: boolean;
  tx: TxRow | null;
  lines: LineRow[];
  terminalName: string;
  terminalId?: string | null;
  operatorCode?: string | null;
  operatorName?: string | null;
  company?: ReceiptCompany | null;
  outlet?: ReceiptOutlet | null;
  variant?: ReceiptVariant;
  copyIssued?: boolean;
  onNewSale: () => void;
  onPrintReceipt?: () => void;
  printingReceipt?: boolean;
}

const PAY_METHOD_LABEL: Record<string, string> = {
  cash: "Kontant",
  card: "Kort",
  vipps: "Vipps",
  invoice: "Faktura",
  gift_card: "Gavekort",
  other: "Annet",
};

function fmt(n: number) {
  return n.toFixed(2).replace(".", ",");
}

function short(id: string | null | undefined) {
  if (!id) return "";
  return id.replace(/-/g, "").slice(0, 14);
}

function resolveVariant(tx: TxRow | null, explicit?: ReceiptVariant): ReceiptVariant {
  if (explicit) return explicit;
  if (tx?.transaction_type === "return") return "return";
  return "sale";
}

function headerLabel(v: ReceiptVariant): { title: string; tone: string } {
  switch (v) {
    case "return":
      return { title: "RETURKVITTERING", tone: "text-red-300" };
    case "proforma":
      return {
        title: "FORELØPIG — IKKE KVITTERING FOR KJØP",
        tone: "text-amber-300",
      };
    case "copy":
      return { title: "KOPI — SALGSKVITTERING", tone: "text-amber-300" };
    case "sale":
    default:
      return { title: "SALGSKVITTERING", tone: "text-[#F4ECDC]" };
  }
}

export function ReceiptView({
  open,
  tx,
  lines,
  terminalName,
  terminalId,
  operatorCode,
  operatorName,
  company,
  outlet,
  variant,
  copyIssued,
  onNewSale,
  onPrintReceipt,
  printingReceipt,
}: Props) {
  if (!tx) return null;
  const v = resolveVariant(tx, variant);
  const isProforma = v === "proforma";
  const isCopy = v === "copy";
  const isReturn = v === "return";

  const mva = parseMvaBreakdown(tx.mva_breakdown);
  const pay = parsePaymentSummary(tx.payment_summary);
  const change = pay.change_given ?? 0;
  const ts = new Date(tx.created_at);
  const dateStr = ts.toLocaleDateString("nb-NO");
  const timeStr = ts.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const headerTitle =
    outlet?.full_name ??
    [company?.name, outlet?.short_name].filter(Boolean).join(" avd. ") ??
    company?.name ??
    terminalName;

  const butikkLine = outlet
    ? `Butikk: ${outlet.display_number ?? ""} ${
        outlet.full_name ?? outlet.short_name ?? ""
      }`.trim()
    : null;

  const tlf = outlet?.phone ?? company?.phone ?? null;
  const orgLine = company?.org_number
    ? `Org.nr: ${company.org_number}${company.vat_registered ? " MVA" : ""}`
    : null;
  const foretak = company?.name ?? null;

  const hdr = headerLabel(v);
  const printDisabled = printingReceipt || isProforma || (copyIssued && !isReturn);

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md border-white/10 bg-[#1B1410] p-0 text-[#F4ECDC]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-xl">
            {isProforma ? "Foreløpig visning" : "Kvittering"}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto px-6 pb-2">
          <div className="space-y-3 font-mono text-[13px] leading-snug">
            {/* ── Merking (banner) ────────────────────────────── */}
            {(isProforma || isCopy) && (
              <div
                className={`rounded border-2 border-current px-3 py-2 text-center text-[12px] font-bold tracking-wider ${hdr.tone}`}
              >
                {hdr.title}
              </div>
            )}

            {/* ── Topphode ────────────────────────────────────── */}
            <div className="text-center">
              <div className="text-base font-semibold">{headerTitle}</div>
              {foretak && foretak !== headerTitle && (
                <div className="text-[11px] text-[#F4ECDC]/70">{foretak}</div>
              )}
              {!isProforma && !isCopy && (
                <div className={`mt-2 font-semibold tracking-wider ${hdr.tone}`}>
                  {hdr.title}
                </div>
              )}
            </div>

            {/* ── Metadata ───────────────────────────────────── */}
            <div className="space-y-0.5 text-[12px]">
              <div className="flex justify-between gap-4">
                <span>Dato: {dateStr}</span>
                <span>Tid: {timeStr}</span>
              </div>
              {butikkLine && <div>{butikkLine}</div>}
              <div className="flex justify-between gap-4">
                {tlf && <span>Tlf: {tlf}</span>}
                {orgLine && <span>{orgLine}</span>}
              </div>
              <div className="flex justify-between gap-4">
                <span>
                  Kvittering:{" "}
                  {tx.receipt_number ?? tx.receipt_sequence ?? "—"}
                </span>
                {(operatorName || operatorCode) && (
                  <span>
                    Selger: {operatorName ?? ""}
                    {operatorName && operatorCode ? ` (${operatorCode})` : operatorCode ?? ""}
                  </span>
                )}
              </div>
              <div className="flex justify-between gap-4">
                <span>Kassepunkt: {terminalName}</span>
                {terminalId && <span>ID: {short(terminalId)}</span>}
              </div>
              {isReturn && tx.reference_transaction_id && (
                <div className="text-red-300">
                  Ref. salg: {short(tx.reference_transaction_id)}
                </div>
              )}
              <div className="text-[11px] uppercase tracking-wider text-[#F4ECDC]/50">
                {tx.dining_mode === "eatin" ? "Spise her" : "Take away"}
              </div>
            </div>

            {/* ── Varelinjer ─────────────────────────────────── */}
            <div className="space-y-1 border-y border-dashed border-white/20 py-3">
              {lines.map((l) => {
                const snap = parseProductSnapshot(l.product_snapshot);
                return (
                  <div key={l.id} className="flex justify-between gap-3">
                    <div className="flex min-w-0 flex-1 gap-2">
                      <span className="tabular-nums">
                        {Number(l.quantity).toFixed(2)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{snap.display_name}</div>
                        {l.line_discount > 0 && (
                          <div className="text-[11px] text-[#F4ECDC]/60">
                            Rabatt: −{fmt(Number(l.line_discount))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="tabular-nums">
                      {fmt(Number(l.line_total_incl_mva))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Totalt ─────────────────────────────────────── */}
            <div className="flex justify-between border-b border-white/20 pb-2 text-base font-bold">
              <span>{isReturn ? "Til utbetaling:" : "Total:"}</span>
              <span className="tabular-nums">
                {fmt(Number(tx.total_incl_mva))}
              </span>
            </div>

            {/* ── Betaling ───────────────────────────────────── */}
            {!isProforma && (
              <div className="space-y-0.5">
                {pay.payments.map((p, i) => (
                  <div key={i} className="flex justify-between">
                    <span>
                      {isReturn ? "Refundert " : ""}
                      {PAY_METHOD_LABEL[p.method] ?? p.method}
                    </span>
                    <span className="tabular-nums">{fmt(p.amount)}</span>
                  </div>
                ))}
                {change > 0 && (
                  <div className="flex justify-between font-semibold text-amber-300">
                    <span>Veksel</span>
                    <span className="tabular-nums">{fmt(change)}</span>
                  </div>
                )}
              </div>
            )}

            {/* ── Spesifisert MVA ────────────────────────────── */}
            <div className="border-t border-dashed border-white/20 pt-2">
              <div className="font-semibold">SPESIFISERT MVA</div>
              <div className="mt-1 grid grid-cols-[1fr_1fr_1fr] gap-2 text-[12px]">
                <div className="text-[#F4ECDC]/60">Sats</div>
                <div className="text-right text-[#F4ECDC]/60">Varekjøp</div>
                <div className="text-right text-[#F4ECDC]/60">MVA</div>
                {mva.map((m) => (
                  <FragmentRow
                    key={m.rate}
                    rate={`${Number(m.rate).toFixed(1)}%`}
                    net={fmt(Number(m.net))}
                    vat={fmt(Number(m.vat))}
                  />
                ))}
                <div className="col-span-3 border-t border-dashed border-white/20" />
                <div>Total</div>
                <div className="text-right tabular-nums">
                  {fmt(Number(tx.subtotal_excl_mva))}
                </div>
                <div className="text-right tabular-nums">
                  {fmt(Number(tx.total_mva))}
                </div>
              </div>
            </div>

            {/* ── Footer ─────────────────────────────────────── */}
            <div className="border-t border-dashed border-white/20 pt-3 text-center text-[11px] text-[#F4ECDC]/60">
              {isProforma ? (
                <>Denne visningen kan ikke brukes som kvittering.</>
              ) : isReturn ? (
                <>Vennligst ta vare på returkvitteringen.</>
              ) : (
                <>
                  Takk for at du handler hos
                  <br />
                  den lokale bakeren!
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-white/10 bg-[#1B1410] p-4">
          {copyIssued && !isCopy && !isProforma && (
            <div className="rounded bg-amber-500/10 px-3 py-1.5 text-center text-[11px] text-amber-200">
              Kvitteringskopi er allerede utstedt for dette salget.
            </div>
          )}
          <div className="flex gap-2">
            {onPrintReceipt && !isProforma && (
              <BigButton
                variant="secondary"
                className="flex-1 text-base"
                onClick={onPrintReceipt}
                disabled={printDisabled}
              >
                {printingReceipt
                  ? "Sender…"
                  : copyIssued && !isReturn
                  ? "Kopi utstedt"
                  : "Skriv ut kvittering"}
              </BigButton>
            )}
            <BigButton className="flex-1 text-base" onClick={onNewSale}>
              {isProforma ? "Lukk" : "Nytt salg"}
            </BigButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FragmentRow({
  rate,
  net,
  vat,
}: {
  rate: string;
  net: string;
  vat: string;
}) {
  return (
    <>
      <div>{rate}</div>
      <div className="text-right tabular-nums">{net}</div>
      <div className="text-right tabular-nums">{vat}</div>
    </>
  );
}
