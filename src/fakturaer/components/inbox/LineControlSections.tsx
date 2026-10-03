import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed, AlertCircle, Clock } from "lucide-react";
import { formatDate, formatMoney } from "@/fakturaer/lib/constants";
import { fmtNum, type ResolveLineCostResult } from "@/fakturaer/lib/units";
import { baseUnitOf, reasonsIn } from "@/fakturaer/lib/lineControl";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { SupplierLinkRow } from "@/fakturaer/hooks/useSupplierLinkContext";
import { STEP_LABELS, type StepState } from "@/fakturaer/lib/lineStatus";
import { cn } from "@/lib/utils";

const STEP_ICON: Record<StepState, typeof CheckCircle2> = {
  done: CheckCircle2,
  suggestion: CircleDashed,
  action: AlertCircle,
  waiting: Clock,
};
const STEP_TONE: Record<StepState, string> = {
  done: "text-success",
  suggestion: "text-warning",
  action: "text-warning",
  waiting: "text-ink-secondary",
};

export function StepSection({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  children: ReactNode;
}) {
  const Icon = STEP_ICON[state];
  return (
    <section
      aria-labelledby={`step-${n}`}
      className={cn("space-y-2 border-t border-line-subtle px-4 py-3", state === "action" && "bg-warning/5")}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`step-${n}`} className="text-sm font-semibold">
          <span className="mr-1 text-primary">{n}</span> {title}
        </h3>
        <span className={cn("inline-flex items-center gap-1 text-caption font-medium", STEP_TONE[state])}>
          <Icon className="h-3.5 w-3.5" aria-hidden /> {STEP_LABELS[state]}
        </span>
      </div>
      {children}
    </section>
  );
}

export function MaterialBody({ line, link }: { line: ReviewLineRow; link: SupplierLinkRow | null }) {
  const top = line.suggestions?.[0];
  const matched = line.matched_raw_material;
  return (
    <div className="space-y-1.5 text-sm">
      <p className="text-caption text-ink-secondary">
        Leverandørens varetekst: <span className="text-ink-primary">{line.description ?? "—"}</span>
        {line.supplier_sku ? ` · varenr. ${line.supplier_sku}` : ""}
      </p>
      {matched ? (
        <p>
          <span className="font-medium">{matched.name}</span>
          {matched.sku ? ` · ${matched.sku}` : ""}
          {matched.base_unit ? ` · kostpris per ${matched.base_unit}` : ""}
          {line.match_confidence !== "manual" && line.match_confidence !== "auto_high" && (
            <span className="ml-1 text-caption text-warning">(automatisk kobling, ikke bekreftet)</span>
          )}
        </p>
      ) : top?.raw_material ? (
        <p>
          <span className="text-caption text-ink-secondary">Forslag fra matchemotoren: </span>
          <span className="font-medium">{top.raw_material.name}</span>
          {top.raw_material.sku ? ` · ${top.raw_material.sku}` : ""}
          <span className="text-caption text-ink-secondary">
            {" "}
            · {Math.round((top.confidence ?? 0) * 100)} %{top.match_reason ? ` · ${top.match_reason}` : ""}
          </span>
        </p>
      ) : (
        <p className="text-ink-secondary">Ingen råvare er koblet, og motoren fant ikke noe forslag.</p>
      )}
      {link && (
        <p className="text-caption text-ink-secondary">
          Husket kobling hos denne leverandøren
          {link.supplier_sku ? ` for varenr. ${link.supplier_sku}` : ""}
          {link.package_size != null ? ` · pakning ${fmtNum(Number(link.package_size))} ${link.package_unit ?? ""}` : ""}
          {link.package_confirmed_at ? ` (bekreftet ${formatDate(link.package_confirmed_at)})` : " (pakning ikke bekreftet)"}.
          Ny pakning må kontrolleres på nytt.
        </p>
      )}
    </div>
  );
}

export function PackageBody({ line, link, cost }: { line: ReviewLineRow; link: SupplierLinkRow | null; cost: ResolveLineCostResult | null }) {
  const reasons = reasonsIn(line, "package");
  const baseUnit = baseUnitOf(line, link);
  const storedBase = line.base_quantity == null ? null : Number(line.base_quantity);
  return (
    <div className="space-y-1.5 text-sm">
      {storedBase != null && baseUnit ? (
        <p className="rounded-md bg-muted/50 px-3 py-2">
          {fmtNum(Number(line.quantity ?? 0))} {line.unit ?? ""} = <strong>{fmtNum(storedBase, 3)} {baseUnit}</strong>
        </p>
      ) : null}
      {cost && !cost.needsInput && cost.explanation && <p className="text-caption text-ink-secondary">{cost.explanation}</p>}
      {cost?.needsInput && <p className="text-caption text-warning">{cost.reason}</p>}
      {!baseUnit && <p className="text-caption text-ink-secondary">Grunnenheten er kjent når råvaren er valgt.</p>}
      {reasons.length > 0 && <p className="text-caption text-warning">Gjenstår: {reasons.join(" · ")}</p>}
    </div>
  );
}

function referenceLabel(line: ReviewLineRow): string {
  const d = line.price_reference_date ? ` ${formatDate(line.price_reference_date)}` : "";
  switch (line.price_reference_source) {
    case "agreement":
      return `Avtalepris${d}`;
    case "last_purchase":
      return `Forrige kjøp${d}`;
    case "start_price":
      return `Startpris${d}`;
    case "conflict":
      return "To likestilte avtaler";
    default:
      return "Mangler prisgrunnlag";
  }
}

export function PriceBody({
  line,
  link,
  state,
  tolerancePct,
}: {
  line: ReviewLineRow;
  link: SupplierLinkRow | null;
  state: StepState;
  tolerancePct: number;
}) {
  const currency = line.invoice.currency ?? "NOK";
  const unit = baseUnitOf(line, link) ?? "grunnenhet";
  const variance = line.price_variance_pct == null ? null : Number(line.price_variance_pct);
  const reasons = reasonsIn(line, "price");
  const fact = (label: string, value: string, hint?: string) => (
    <div>
      <dt className="text-caption text-ink-secondary">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
      {hint && <dd className="text-caption text-ink-secondary">{hint}</dd>}
    </div>
  );
  return (
    <div className="space-y-2 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {fact(
          state === "done" ? "Ny pris fra fakturalinjen" : "Foreløpig pris fra fakturalinjen",
          line.price_per_base_unit == null ? "Kan ikke beregnes ennå" : `${formatMoney(Number(line.price_per_base_unit), currency)} / ${unit}`,
        )}
        {fact(
          "Prisgrunnlag",
          line.expected_price_per_base_unit == null ? "—" : `${formatMoney(Number(line.expected_price_per_base_unit), currency)} / ${unit}`,
          referenceLabel(line),
        )}
        {link?.agreed_price_per_base_unit != null &&
          fact("Avtalepris", `${formatMoney(Number(link.agreed_price_per_base_unit), "NOK")} / ${unit}`)}
        {link?.last_invoice_price != null &&
          fact(
            "Siste fakturapris",
            `${formatMoney(Number(link.last_invoice_price), "NOK")} / ${unit}`,
            link.last_invoice_date ? formatDate(link.last_invoice_date) : undefined,
          )}
      </dl>
      {variance != null && (
        <p className={cn("rounded-md px-3 py-1.5 text-caption", reasons.length > 0 ? "bg-warning/10 text-warning" : "bg-muted/50")}>
          {variance > 0 ? "+" : ""}
          {fmtNum(variance, 1)} % mot prisgrunnlaget · toleranse {fmtNum(tolerancePct, 1)} %
        </p>
      )}
      {reasons.length > 0 && <p className="text-caption text-warning">Gjenstår: {reasons.join(" · ")}</p>}
      {state === "waiting" && (
        <p className="text-caption text-ink-secondary">Kostprisen er ikke bekreftet før råvare og pakning er avklart.</p>
      )}
    </div>
  );
}
