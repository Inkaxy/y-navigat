import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { AgreementDocumentLink } from "@/ravarer/components/AgreementDocumentLink";
import { NewAgreementDialog } from "@/ravarer/components/NewAgreementDialog";
import { AGREEMENT_STATUS_CLASS, AGREEMENT_STATUS_LABEL, getAgreementStatus } from "@/ravarer/lib/agreementStatus";
import { formatDate, formatNok } from "@/ravarer/lib/constants";
import { isAgreementConfirmed } from "@/ravarer/lib/priceTimeline";
import { paths } from "@/ravarer/lib/paths";
import { cn } from "@/lib/utils";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useSupplierItems, type SupplierItemRow } from "@/ravarer/hooks/useSupplierDetail";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";

/** Leverandørens avtaler. Status er bare en etikett; datoer og bekreftelse vises separat. */
export function SupplierAgreementsSection({ supplier }: { supplier: SupplierRow }) {
  const { canWrite } = useRavarer();
  const q = useSupplierItems(supplier.id);
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => (q.data ?? []).filter((r) => r.agreed_price_per_base_unit != null), [q.data]);
  const status = (r: SupplierItemRow) => getAgreementStatus(r.agreement_valid_from, r.agreement_valid_to);
  const columns: Column<SupplierItemRow>[] = [
    { id: "name", header: "Vare", alwaysVisible: true, sortKey: (r) => r.raw_material?.name ?? "",
      cell: (r) => <Link to={paths.raavare(r.raw_material_id, { seksjon: "leverandorer" })} className="font-medium hover:underline">{r.raw_material?.name ?? "Ukjent råvare"}</Link> },
    { id: "price", header: "Pris / grunnenhet", align: "right", sortKey: (r) => r.agreed_price_per_base_unit ?? -1,
      cell: (r) => <span className="tabular-nums">{formatNok(r.agreed_price_per_base_unit)}{r.raw_material?.base_unit ? ` /${r.raw_material.base_unit}` : ""}</span> },
    { id: "dates", header: "Gyldig", sortKey: (r) => r.agreement_valid_to ?? "9999", cell: (r) => `${formatDate(r.agreement_valid_from)} – ${r.agreement_valid_to ? formatDate(r.agreement_valid_to) : "uten sluttdato"}` },
    { id: "status", header: "Status", cell: (r) => <span className={cn("rounded-md border px-1.5 py-0.5 text-caption", AGREEMENT_STATUS_CLASS[status(r)])}>{AGREEMENT_STATUS_LABEL[status(r)]}</span> },
    { id: "confirmed", header: "Bekreftet", cell: (r) => (isAgreementConfirmed(r) ? <span className="text-success">Ja</span> : <span className="text-warning">Nei — eldre registrert pris</span>) },
    { id: "doc", header: "Dokument", cell: (r) => (r.agreement_document_url ? <AgreementDocumentLink path={r.agreement_document_url} /> : "—") },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-secondary">Pris gjelder bare når datoene og bekreftelsen stemmer. Åpne varen for å endre avtalen.</p>
        {canWrite && <Button className="min-h-[44px] gap-1.5 md:min-h-9" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />Ny avtale</Button>}
      </div>
      <DataTable ariaLabel={`Avtaler med ${supplier.name}`} rows={q.isLoading ? undefined : rows} columns={columns} getId={(r) => r.id}
        isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} emptyText="Ingen avtaler med denne leverandøren."
        renderMobileCard={(r) => (
          <div className="space-y-1">
            <Link to={paths.raavare(r.raw_material_id, { seksjon: "leverandorer" })} className="font-medium hover:underline">{r.raw_material?.name ?? "Ukjent råvare"}</Link>
            <div className="tabular-nums">{formatNok(r.agreed_price_per_base_unit)}{r.raw_material?.base_unit ? ` /${r.raw_material.base_unit}` : ""}</div>
            <div className="text-caption text-ink-secondary">{formatDate(r.agreement_valid_from)} – {r.agreement_valid_to ? formatDate(r.agreement_valid_to) : "uten sluttdato"} · {AGREEMENT_STATUS_LABEL[status(r)]} · {isAgreementConfirmed(r) ? "Bekreftet" : "Ikke bekreftet"}</div>
          </div>
        )}
      />
      <NewAgreementDialog open={open} onOpenChange={setOpen} defaultSupplierId={supplier.id} />
    </div>
  );
}
