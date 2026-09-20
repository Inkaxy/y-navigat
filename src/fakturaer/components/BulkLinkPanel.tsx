import { AlertTriangle, Loader2 } from "lucide-react";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { QueryState } from "@/components/common/QueryState";
import { formatDate } from "@/fakturaer/lib/constants";

export interface BulkLinkCandidate {
  line_id: string;
  invoice_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  description: string | null;
  supplier_sku: string | null;
  quantity: number | null;
  unit: string | null;
  total_amount: number | null;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
  raw_material_id: string | null;
  match_confidence: string | null;
  eligible: boolean;
  exclusion_reason: string | null;
}

/** Menneskelig forklaring på hvorfor en linje ikke kan kobles herfra. */
export const EXCLUSION_LABELS: Record<string, string> = {
  faktura_last: "fakturaen er låst (avstemt, flagget eller kansellert)",
  faktura_flagget: "fakturaen er flagget for oppfølging",
  kreditnota: "linjen står på en kreditnota",
  annen_valuta: "fakturaen er i en annen valuta enn kroner",
  merket_ikke_aktuell: "linjen er merket som ikke aktuell",
  koblet_til_annen_vare: "linjen er allerede koblet manuelt til en annen vare",
  tvetydig_alias: "samme varenummer eller navn peker på flere varer",
  annen_pakning: "pakningen er en annen (størrelse, enhet eller antall per kartong)",
  annen_pakning_beskrivelse: "pakningen i varenavnet er en annen enn koblingens pakning",
  ukjent_pakning: "pakningen er ikke bekreftet, så kiloprisen kan ikke regnes",
  ikke_lenger_aktuell: "linjen var ikke lenger aktuell da koblingen ble brukt",
};

export function exclusionText(reason: string | null): string {
  if (!reason) return "ukjent grunn";
  return EXCLUSION_LABELS[reason] ?? reason;
}

export interface BulkLinkPanelProps {
  rawMaterialName: string;
  rows: BulkLinkCandidate[];
  selected: Record<string, boolean>;
  onToggle: (lineId: string, value: boolean) => void;
  busy: boolean;
  chosenCount: number;
  onApply: () => void;
  onClose: () => void;
  applyPending: boolean;
  /** Fakturaer som er koblet, men ikke regnet om — ingen falsk suksess. */
  pendingInvoices: string[];
  appliedCount: number;
  onRetry: () => void;
  retryPending: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetryLoad: () => void;
}

/**
 * Innholdet i massekoblingsdialogen, uten datahenting, slik at presentasjonen
 * kan vises med faste data i utviklingsforhåndsvisningen.
 */
export function BulkLinkPanel({
  rawMaterialName,
  rows,
  selected,
  onToggle,
  busy,
  chosenCount,
  onApply,
  onClose,
  applyPending,
  pendingInvoices,
  appliedCount,
  onRetry,
  retryPending,
  isLoading,
  isError,
  error,
  onRetryLoad,
}: BulkLinkPanelProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Bruk koblingen på flere linjer</DialogTitle>
        <DialogDescription>
          Andre linjer fra samme leverandør som ser ut til å være <strong>{rawMaterialName}</strong>. Velg selv hvilke
          som skal kobles — ingenting blir koblet automatisk, og prisen regnes om etterpå.
        </DialogDescription>
      </DialogHeader>

      {pendingInvoices.length > 0 ? (
        <div className="space-y-3 rounded-md border border-warning/40 bg-warning/5 p-4">
          <p className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span>
              {appliedCount} {appliedCount === 1 ? "linje" : "linjer"} er koblet, men prisen er <strong>ikke</strong> regnet om for{" "}
              {pendingInvoices.length} faktura(er). Linjene står merket «må beregnes på nytt» og kan ikke avstemmes før
              beregningen er kjørt.
            </span>
          </p>
          <Button onClick={onRetry} disabled={retryPending}>
            {retryPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Prøv beregningen på nytt
          </Button>
        </div>
      ) : (
        <QueryState
          scope="fakturaer:massekobling"
          isLoading={isLoading}
          isError={isError}
          error={error}
          isEmpty={rows.length === 0}
          emptyTitle="Ingen andre linjer peker på denne varen"
          onRetry={onRetryLoad}
        >
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {rows.map((r) => (
              <label
                key={r.line_id}
                className="flex items-start gap-3 rounded-md border border-line-subtle px-3 py-2 text-sm"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={!!selected[r.line_id]}
                  disabled={!r.eligible || busy}
                  onCheckedChange={(v) => onToggle(r.line_id, v === true)}
                  aria-label={`Velg linje ${r.description ?? r.line_id}`}
                />
                <span className="flex-1">
                  <span className="block font-medium">{r.description ?? "Uten beskrivelse"}</span>
                  <span className="block text-caption text-ink-secondary">
                    {r.invoice_number ?? "—"} · {formatDate(r.invoice_date)} · {r.quantity ?? "—"} {r.unit ?? ""}
                    {r.supplier_sku ? ` · varenr. ${r.supplier_sku}` : ""}
                    {r.package_size != null ? ` · pakning ${r.package_size} ${r.package_unit ?? ""}` : ""}
                    {r.count_per_package != null ? ` · ${r.count_per_package} per kartong` : ""}
                  </span>
                  {!r.eligible && (
                    <span className="block text-caption text-warning">
                      Kan ikke kobles herfra: {exclusionText(r.exclusion_reason)}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </QueryState>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy || pendingInvoices.length > 0}>
          Lukk
        </Button>
        {pendingInvoices.length === 0 && (
          <Button onClick={onApply} disabled={busy || chosenCount === 0}>
            {applyPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Koble {chosenCount} {chosenCount === 1 ? "linje" : "linjer"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
