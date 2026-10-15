import { useMemo } from "react";
import { OrderDeskKpi } from "@/ordre/components/dashboard/OrderDeskKpi";
import { BookOpen, Coins, FileText, Handshake, Package, Percent, Truck, Wallet } from "lucide-react";
import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { chooseAgreedPrice, pricePerPackage } from "@/ravarer/lib/rawMaterialKpi";
import { latestInvoiceOf, reasonLabel } from "@/ravarer/lib/listPriceEvidence";
import type { MaterialPriceEvidence } from "@/ravarer/hooks/useMaterialPriceEvidence";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import type { RmSupplierRow } from "@/ravarer/hooks/useRmSuppliers";
import { paths } from "@/ravarer/lib/paths";
import { isAgreementConfirmed } from "@/ravarer/lib/priceTimeline";
import { confirmedFactor, packageLabel } from "@/ravarer/lib/supplierPackagePrice";

import { costSummary } from "@/ravarer/lib/costSummary";

interface Props {
  rm: RawMaterialRow;
  links: readonly RmSupplierRow[];
  /** Bundet serverbevis (samme eier som listen). Leverandørbufferen brukes aldri. */
  evidence: MaterialPriceEvidence;
  recipeCount: number;
  spend12m: number | null;
}

export function RawMaterialKpiStrip({ rm, links, evidence, recipeCount, spend12m }: Props) {
  const { data: suppliers = [] } = useSuppliers();
  const supplierName = useMemo(() => {
    const map = new Map(suppliers.map((s) => [s.id, s.name]));
    return (id: string | null) => (id ? (map.get(id) ?? "Ukjent") : null);
  }, [suppliers]);

  const primary = useMemo(
    () => links.find((l) => l.is_primary) ?? links.find((l) => l.supplier_id === rm.primary_supplier_id) ?? null,
    [links, rm.primary_supplier_id],
  );

  const agreed = chooseAgreedPrice({
    linkPricePerBaseUnit: primary?.agreed_price_per_base_unit ?? null,
    linkValidFrom: primary?.agreement_valid_from ?? null,
    linkValidTo: primary?.agreement_valid_to ?? null,
    rawMaterialAgreedPrice: rm.agreed_price,
  });

  // Avtalen vises som registrert/bekreftet, men erstatter aldri serverens kostprisavvik.
  const agreementOk = agreed.source === "link" && !!primary && isAgreementConfirmed(primary);
  const cost = costSummary(rm, evidence.cost);
  const verified = cost.verified;
  const bound = evidence.bound;
  const latest = latestInvoiceOf(bound);
  const pendingLabel = evidence.loading ? "Kontrollerer prisgrunnlag …" : evidence.isError ? "Prisgrunnlag kunne ikke kontrolleres" : "Prisgrunnlag ikke kontrollert";
  const devPct = bound && bound.status === "eligible" ? bound.deviationPct : null;
  const devReason = !bound ? pendingLabel : bound.status === "eligible" ? null : reasonLabel(bound.costReason ?? bound.invoiceReason ?? bound.reason);
  const invoiceSub = !bound
    ? pendingLabel
    : !latest.date
      ? reasonLabel(bound.invoiceReason ?? bound.reason)
      : [formatDate(latest.date), latest.number ? `Faktura ${latest.number}` : null, latest.reason].filter(Boolean).join(" · ");

  const factor = confirmedFactor(rm);
  const perPackage = verified ? pricePerPackage(rm.current_cost_price, factor) : null;
  const pk = packageLabel(rm, rm.base_unit);
  const primarySupplierId = primary?.supplier_id ?? rm.primary_supplier_id;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <OrderDeskKpi
        icon={Coins}
        label={`Kostpris / ${rm.base_unit}`}
        value={cost.value}
        tone={cost.verified ? "default" : "warning"}
        sub={[cost.status, cost.precise, cost.source].filter(Boolean).join(" · ")}
      />
      <OrderDeskKpi
        icon={Package}
        label="Pris per standardpakning"
        value={perPackage != null ? formatNok(perPackage) : "—"}
        sub={
          factor == null
            ? (rm.base_units_per_package ? "Standardpakning må bekreftes – se leverandørpakning" : "Standardpakning ikke angitt – se leverandørpakning")
            : !verified ? "Kostpris må kontrolleres" : (pk.label ?? "")
        }
      />
      <OrderDeskKpi
        icon={FileText}
        label="Siste fakturapris"
        value={latest.price != null && bound?.baseUnit ? `${formatNok(latest.price)} / ${bound.baseUnit}` : latest.date ? "Ukjent" : "—"}
        sub={invoiceSub}
      />
      <OrderDeskKpi
        icon={Handshake}
        label={`Avtalepris / ${rm.base_unit}`}
        value={agreed.value != null ? formatNok(agreed.value) : "—"}
        sub={
          agreed.source === "link" && !agreementOk
            ? "Registrert avtalepris — ikke bekreftet"
            : agreed.source === "link"
            ? `Primærkobling${agreed.validTo ? ` · gyldig til ${formatDate(agreed.validTo)}` : " · uten sluttdato"}`
            : agreed.source === "raw_material"
              ? "Eldre avtalepris — brukes ikke"
              : "Ingen avtalepris"
        }
      />
      <OrderDeskKpi
        icon={Percent}
        tone={devPct != null && devPct > 5 ? "warning" : "default"}
        label="Siste faktura mot kostpris"
        value={devPct != null ? `${devPct > 0 ? "+" : ""}${formatNumber(devPct, 1)} %` : "—"}
        sub={devReason ?? `Kontrollert ${formatDate(evidence.checkedAt)} · ikke avtalepris`}
      />
      <OrderDeskKpi
        icon={Truck}
        label="Primærleverandør"
        to={primarySupplierId ? paths.leverandor(primarySupplierId) : undefined}
        value={primarySupplierId ? (supplierName(primarySupplierId) ?? "—") : "—"}
        sub={primary?.supplier_sku ? `Lev.nr ${primary.supplier_sku}` : "Ingen leverandør-SKU"}
      />
      <OrderDeskKpi icon={Wallet} label="Kjøpt 12 mnd" value={spend12m != null ? formatNok(spend12m) : "—"} sub="Fakturabeløp eks. mva" />
      <OrderDeskKpi icon={BookOpen} label="Brukt i oppskrifter" value={String(recipeCount)} sub={recipeCount === 1 ? "1 oppskrift" : `${recipeCount} oppskrifter`} />
    </div>
  );
}
