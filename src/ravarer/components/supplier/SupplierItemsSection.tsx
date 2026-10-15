import { Link } from "react-router-dom";
import { SupplierItemStatusChips } from "@/fakturaer/components/supplier-item/SupplierItemStatusChips";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import { formatDate, formatNok } from "@/ravarer/lib/constants";
import { isAgreementConfirmed } from "@/ravarer/lib/priceTimeline";
import { packageLabel } from "@/ravarer/lib/supplierPackagePrice";
import { paths } from "@/ravarer/lib/paths";
import { useSupplierItems, type SupplierItemRow } from "@/ravarer/hooks/useSupplierDetail";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";
import { SupplierPriceTimeline } from "./SupplierPriceTimeline";
import { useMemo } from "react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useSupplierLatestPurchase, type SupplierLatest } from "@/ravarer/hooks/useSupplierLatestPurchase";

export function latestCell(l: SupplierLatest) {
  switch (l.kind) {
    case "loading": return <span className="text-ink-secondary">Kontrollerer …</span>;
    case "error": return <span className="text-destructive">Kunne ikke hentes</span>;
    case "price":
      return (
        <span className="tabular-nums">
          {formatNok(l.price)}<span className="text-caption text-ink-secondary"> /{l.unit}</span>
          <span className="block text-caption text-ink-secondary">{formatDate(l.date)}</span>
        </span>
      );
    case "control":
      return (
        <span>
          <Link to={paths.faktura(l.invoiceId)} className="text-warning hover:underline">Må kontrolleres</Link>
          <span className="block text-caption text-ink-secondary">{formatDate(l.date)}{l.reason ? ` · ${l.reason}` : ""}</span>
        </span>
      );
    case "unknown": return <span className="text-caption text-ink-secondary">Ukjent · {l.reason}</span>;
  }
}

/** Koblingens redigering skjer i råvarekortets leverandørseksjon (samme redigerere, samme RPC-er). */
export const editLinkHref = (r: Pick<SupplierItemRow, "raw_material_id">) => paths.raavare(r.raw_material_id, { seksjon: "leverandorer" });

/** Pakning slik den faktisk er dokumentert: bekreftet faktor, eller registrert/ukjent — aldri utfylt. */
function packageCell(r: SupplierItemRow) {
  const pk = packageLabel(r, r.raw_material?.base_unit ?? "grunnenhet");
  return (
    <span>
      {pk.label ?? <span className="text-ink-secondary">Ikke registrert</span>}
      <span className={pk.confirmed ? "block text-caption text-success" : "block text-caption text-warning"}>{pk.confirmed ? "Bekreftet pakning" : "Pakning ikke bekreftet"}</span>
    </span>
  );
}

const editLabel = (r: SupplierItemRow) => (packageLabel(r, r.raw_material?.base_unit ?? "").confirmed ? "Rediger kobling" : "Bekreft pakning");

function agreementCell(r: SupplierItemRow) {
  if (r.agreed_price_per_base_unit == null) return <span className="text-ink-secondary">—</span>;
  return (
    <span className="tabular-nums">
      {formatNok(r.agreed_price_per_base_unit)}{r.raw_material?.base_unit ? <span className="text-caption text-ink-secondary"> /{r.raw_material.base_unit}</span> : null}
      <span className={isAgreementConfirmed(r) ? "block text-caption text-success" : "block text-caption text-warning"}>
        {isAgreementConfirmed(r) ? "Bekreftet avtale" : "Registrert — ikke bekreftet"}
      </span>
    </span>
  );
}

export function SupplierItemsSection({ supplier }: { supplier: SupplierRow }) {
  const q = useSupplierItems(supplier.id);
  const { legalEntityId } = useRavarer();
  const materialIds = useMemo(() => (q.data ?? []).map((r) => r.raw_material_id), [q.data]);
  const latestOf = useSupplierLatestPurchase(legalEntityId, supplier.id, materialIds);
  const columns: Column<SupplierItemRow>[] = [
    { id: "name", header: "Vare", alwaysVisible: true, sortKey: (r) => r.raw_material?.name ?? "",
      cell: (r) => (
        <span className="flex flex-col">
          <span className="flex items-center gap-2">
            <Link to={paths.raavare(r.raw_material_id)} className="font-medium hover:underline">{r.raw_material?.name ?? "Ukjent råvare"}</Link>
            <ItemTypeBadge itemType={r.raw_material?.item_type ?? null} />
          </span>
          {r.supplier_product_name && <span className="text-caption text-ink-secondary">{r.supplier_product_name}</span>}
        </span>
      ) },
    { id: "sku", header: "Lev.nr", sortKey: (r) => r.supplier_sku ?? "", cell: (r) => <span className="font-mono text-xs">{r.supplier_sku ?? "—"}</span> },
    { id: "package", header: "Pakning", cell: packageCell },
    { id: "agreed", header: "Avtalepris / grunnenhet", align: "right", sortKey: (r) => r.agreed_price_per_base_unit ?? -1, cell: agreementCell },
    { id: "latest", header: "Siste kjøpspris", align: "right", cell: (r) => latestCell(latestOf(r.raw_material_id)) },
    { id: "validity", header: "Gyldighet", cell: (r) => (r.agreement_valid_from || r.agreement_valid_to ? `${formatDate(r.agreement_valid_from)} – ${formatDate(r.agreement_valid_to)}` : "—") },
    { id: "edit", header: "", cell: (r) => <Link to={editLinkHref(r)} className="inline-flex min-h-[44px] items-center text-primary hover:underline md:min-h-0">{editLabel(r)}</Link> },
  ];
  return (
    <div className="space-y-4">
      <SupplierItemStatusChips supplierId={supplier.id} />
      <DataTable
        ariaLabel={`Varer fra ${supplier.name}`}
        rows={q.data}
        columns={columns}
        getId={(r) => r.id}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        emptyText="Ingen varer er koblet til denne leverandøren ennå."
        renderMobileCard={(r) => (
          <div className="space-y-1">
            <Link to={paths.raavare(r.raw_material_id)} className="font-medium hover:underline">{r.raw_material?.name ?? "Ukjent råvare"}</Link>
            <div className="text-caption text-ink-secondary">{r.supplier_sku ? `Lev.nr ${r.supplier_sku}` : "Uten lev.nr"}</div>
            <div className="text-sm">{packageCell(r)}</div>
            <div>{agreementCell(r)}</div>
            <div className="text-sm"><span className="text-caption text-ink-secondary">Siste kjøp: </span>{latestCell(latestOf(r.raw_material_id))}</div>
            <Link to={editLinkHref(r)} className="inline-flex min-h-[44px] items-center text-primary hover:underline">{editLabel(r)}</Link>
          </div>
        )}
      />
      {(q.data?.length ?? 0) > 0 && <SupplierPriceTimeline supplierId={supplier.id} supplierName={supplier.name} items={q.data ?? []} />}
    </div>
  );
}
