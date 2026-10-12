import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useCostPriceSource } from "@/ravarer/hooks/useCostPriceSource";
import { COST_STATUS_LABEL } from "@/ravarer/lib/costPriceSource";
import { formatDate, formatNok } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";

/** Viser hvor gjeldende kostpris kommer fra: faktura, leverandør, dato og kr/grunnenhet. */
export function CostSourceInfo({ rawMaterialId }: { rawMaterialId: string }) {
  const q = useCostPriceSource(rawMaterialId);
  if (q.isLoading) return <p className="text-caption text-ink-secondary">Henter kilde …</p>;
  if (q.isError || !q.data) return <p className="text-caption text-destructive">Kunne ikke hente kilden til kostprisen.</p>;
  const d = q.data;
  const unit = d.baseUnit ?? "enhet";
  const warn = d.status !== "ok";
  return (
    <div className="rounded-md border border-line-subtle p-3 text-sm" aria-live="polite">
      <p className={warn ? "flex items-center gap-1.5 font-medium text-warning" : "font-medium"}>
        {warn && <AlertTriangle className="h-4 w-4" aria-hidden />}
        {COST_STATUS_LABEL[d.status]}
        {d.currentPrice != null && <span className="ml-1 tabular-nums">· lagret {formatNok(d.currentPrice)}/{unit}</span>}
      </p>
      {d.source ? (
        <p className="mt-1 text-ink-secondary">
          Nyeste gyldige: <span className="tabular-nums">{formatNok(d.source.price)}/{unit}</span> · {formatDate(d.source.effectiveDate)}
          {d.source.supplierName && <> · {d.source.supplierName}</>}
          {d.source.invoiceId ? (
            <> · <Link className="text-primary underline-offset-2 hover:underline" to={paths.faktura(d.source.invoiceId)}>faktura {d.source.invoiceNumber ?? ""}</Link></>
          ) : <> · {d.source.source === "invoice" ? "faktura" : "manuell dokumentert pris"}</>}
          <span className="block text-caption">Kilde-ID {d.source.historyId}</span>
        </p>
      ) : (
        <p className="mt-1 text-ink-secondary">
          {d.status === "mangler" ? "Ingen kostpris og ingen gyldig kilde — kalkyler med denne råvaren er ufullstendige." : "Prisen har ingen gyldig faktura eller dokumentert kilde. Kontroller den før den brukes i kalkyler."}
        </p>
      )}
      {d.next && (
        <p className="mt-1 text-caption text-ink-secondary">Planlagt: {formatNok(d.next.price)}/{unit} fra {formatDate(d.next.effectiveDate)}</p>
      )}
    </div>
  );
}
