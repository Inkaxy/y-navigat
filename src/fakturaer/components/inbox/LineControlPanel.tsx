import { ChevronLeft, ChevronRight, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/fakturaer/lib/constants";
import { fmtNum } from "@/fakturaer/lib/units";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { SupplierLinkRow } from "@/fakturaer/hooks/useSupplierLinkContext";
import type { LineStatus } from "@/fakturaer/lib/lineStatus";
import { LineStatusBadge } from "@/fakturaer/components/inbox/LineStatusBadge";
import { MaterialBody, PackageBody, PriceBody, StepSection } from "@/fakturaer/components/inbox/LineControlSections";
import { costOf } from "@/fakturaer/lib/lineControl";

export type LineDialogAction = "match" | "create" | "not_rm" | "conflict" | "start_price";

interface Props {
  line: ReviewLineRow;
  status: LineStatus;
  link: SupplierLinkRow | null;
  tolerancePct: number;
  position: { index: number; total: number };
  canWrite: boolean;
  busy: boolean;
  onAction: (a: LineDialogAction, line: ReviewLineRow) => void;
  onAccept: (line: ReviewLineRow) => void;
  onPrev: () => void;
  onNext: () => void;
  onShowDocument: (line: ReviewLineRow) => void;
}

interface Primary {
  label: string;
  run: (() => void) | null;
  explain: string;
}

function primaryFor(p: Props): Primary {
  const { line, status, onAction, onAccept } = p;
  const top = line.suggestions?.[0]?.raw_material?.name;
  switch (status.key) {
    case "conflict":
      return { label: "Løs konflikt", run: () => onAction("conflict", line), explain: "Varenummeret peker på flere råvarer." };
    case "choose_material":
      return { label: "Velg råvare", run: () => onAction("match", line), explain: "Søk opp riktig råvare i registeret." };
    case "confirm_material":
      return !line.raw_material_id && top
        ? {
            label: `Godta forslag: ${top}`,
            run: () => onAccept(line),
            explain: "Pakning og pris kontrolleres på nytt etter godkjenning. Du kan angre.",
          }
        : { label: "Kontroller kobling", run: () => onAction("match", line), explain: "Koblingen er automatisk og må bekreftes." };
    case "confirm_package":
      return { label: "Bekreft pakning", run: () => onAction("match", line), explain: "Mengden kan ikke regnes om til grunnenhet før pakningen er bekreftet." };
    case "review_price":
      return { label: "Se over pris", run: () => onAction("match", line), explain: "Prisen avviker, eller prisgrunnlaget mangler." };
    case "start_price":
      return { label: "Bekreft startpris", run: () => onAction("start_price", line), explain: "Første bekreftede kjøpspris kan lagres som startpris." };
    case "recalculate":
    case "check_line":
      return { label: "Kontroller linjen", run: () => onAction("match", line), explain: "Linjen må kontrolleres før den kan avstemmes." };
    case "ready":
      return { label: "Linjen er klar", run: null, explain: "Fakturaen bekreftes samlet med «Bekreft prismatch» på fakturakortet." };
    case "not_applicable":
      return { label: "Utelatt", run: null, explain: "Linjen er markert som ikke råvare og telles som behandlet." };
  }
}

/** Kontrollflaten for valgt linje: Råvare → Pakning og mengde → Kostpris. */
export function LineControlPanel(props: Props) {
  const { line, status, link, tolerancePct, position, canWrite, busy, onAction, onPrev, onNext, onShowDocument } = props;
  const currency = line.invoice.currency ?? "NOK";
  const cost = costOf(line, link);
  const primary = primaryFor(props);
  const disabledReason = !canWrite ? "Du har ikke skrivetilgang til fakturakontroll." : primary.run ? null : primary.explain;
  const editable = canWrite && status.key !== "not_applicable";

  return (
    <article className="overflow-hidden rounded-xl border border-line-subtle bg-card" aria-label="Valgt fakturalinje">
      <header className="space-y-1 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-ink-secondary">
            Linje {position.index + 1} av {position.total}
            {line.supplier_sku ? ` · ${line.supplier_sku}` : ""}
            {` · ${line.invoice.invoice_number}`}
          </span>
          <div className="flex items-center gap-1">
            <LineStatusBadge status={status} />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onPrev} disabled={position.index <= 0} aria-label="Forrige linje">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNext} disabled={position.index >= position.total - 1} aria-label="Neste linje">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <h2 className="text-title font-serif">{line.description ?? "Uten varetekst"}</h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-sm">
          <div>
            <dt className="text-caption text-ink-secondary">Fakturert</dt>
            <dd className="tabular-nums">{line.quantity == null ? "—" : fmtNum(Number(line.quantity))} {line.unit ?? ""}</dd>
          </div>
          <div>
            <dt className="text-caption text-ink-secondary">Pris per {line.unit ?? "enhet"}</dt>
            <dd className="tabular-nums">{formatMoney(line.unit_price, currency)}</dd>
          </div>
          <div>
            <dt className="text-caption text-ink-secondary">Linjesum (eks. mva)</dt>
            <dd className="tabular-nums">{formatMoney(line.total_amount, currency)}</dd>
          </div>
        </dl>
      </header>

      <StepSection n={1} title="Råvare" state={status.steps.material}>
        <MaterialBody line={line} link={link} />
        {editable && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <button type="button" className="text-primary underline underline-offset-2" onClick={() => onAction("match", line)}>
              {line.raw_material_id ? "Endre råvare" : "Søk råvare"}
            </button>
            <button type="button" className="text-primary underline underline-offset-2" onClick={() => onAction("create", line)}>
              Ny råvare
            </button>
            <button type="button" className="text-primary underline underline-offset-2" onClick={() => onAction("not_rm", line)}>
              Ikke råvare
            </button>
          </div>
        )}
        {editable && (
          <p className="text-caption text-ink-secondary">
            Endrer du råvare eller pakning, beregnes kostprisen på nytt og må kontrolleres igjen. «Ikke råvare» holder linjen utenfor prishistorikken.
          </p>
        )}
      </StepSection>

      <StepSection n={2} title="Pakning og mengde" state={status.steps.package}>
        <PackageBody line={line} link={link} cost={cost} />
      </StepSection>

      <StepSection n={3} title="Kostpris" state={status.steps.price}>
        <PriceBody line={line} link={link} state={status.steps.price} tolerancePct={tolerancePct} />
      </StepSection>

      <footer className="flex flex-col gap-3 border-t border-line-subtle bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-caption text-ink-secondary" id={`primary-hint-${line.id}`}>
          {disabledReason ?? primary.explain}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={!line.invoice.source_document_url}
            onClick={() => onShowDocument(line)}
          >
            <FileText className="h-4 w-4" /> Faktura
          </Button>
          <Button variant="outline" size="sm" onClick={onNext} disabled={position.index >= position.total - 1}>
            Neste linje
          </Button>
          <Button
            size="sm"
            disabled={!!disabledReason || busy}
            aria-describedby={`primary-hint-${line.id}`}
            onClick={() => primary.run?.()}
          >
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {primary.label}
          </Button>
        </div>
      </footer>
    </article>
  );
}
