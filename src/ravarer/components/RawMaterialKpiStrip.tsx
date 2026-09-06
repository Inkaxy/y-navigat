import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Kpi } from "@/ravarer/components/Kpi";
import { formatDate, formatNok } from "@/ravarer/lib/constants";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { chooseAgreedPrice, kpiDeviation, pricePerPackage } from "@/ravarer/lib/rawMaterialKpi";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import type { RmSupplierRow } from "@/ravarer/hooks/useRmSuppliers";

interface Props {
  rm: RawMaterialRow;
  links: readonly RmSupplierRow[];
  recipeCount: number;
  spend12m: number | null;
}

export function RawMaterialKpiStrip({ rm, links, recipeCount, spend12m }: Props) {
  const { data: suppliers = [] } = useSuppliers();
  const supplierName = useMemo(() => {
    const map = new Map(suppliers.map((s) => [s.id, s.name]));
    return (id: string | null) => (id ? (map.get(id) ?? "Ukjent") : null);
  }, [suppliers]);

  const primary = useMemo(
    () => links.find((l) => l.is_primary) ?? links.find((l) => l.supplier_id === rm.primary_supplier_id) ?? null,
    [links, rm.primary_supplier_id],
  );

  const lastInvoice = useMemo(() => {
    const withPrice = links.filter((l) => l.last_invoice_price != null && l.last_invoice_date);
    return withPrice.sort((a, b) => (b.last_invoice_date ?? "").localeCompare(a.last_invoice_date ?? ""))[0] ?? null;
  }, [links]);

  const agreed = chooseAgreedPrice({
    linkPricePerBaseUnit: primary?.agreed_price_per_base_unit ?? null,
    linkValidFrom: primary?.agreement_valid_from ?? null,
    linkValidTo: primary?.agreement_valid_to ?? null,
    rawMaterialAgreedPrice: rm.agreed_price,
  });

  const deviation = kpiDeviation(
    lastInvoice?.last_invoice_price ?? null,
    agreed.value,
    rm.current_cost_price,
  );

  const perPackage = pricePerPackage(rm.current_cost_price, rm.base_units_per_package);
  const primarySupplierId = primary?.supplier_id ?? rm.primary_supplier_id;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi
        label={`Kostpris / ${rm.base_unit}`}
        value={formatNok(rm.current_cost_price)}
        hint={
          rm.price_updated_at
            ? `${rm.price_source ?? "ukjent kilde"} · ${formatDate(rm.price_updated_at)}`
            : "Ingen kilde registrert"
        }
      />
      <Kpi
        label="Pris per pakning"
        value={perPackage != null ? formatNok(perPackage) : "—"}
        hint={
          rm.base_units_per_package
            ? `${rm.base_units_per_package} ${rm.base_unit} per pakning`
            : "Pakningsstørrelse mangler"
        }
      />
      <Kpi
        label="Siste fakturapris"
        value={lastInvoice?.last_invoice_price != null ? formatNok(lastInvoice.last_invoice_price) : "—"}
        hint={
          lastInvoice
            ? `${formatDate(lastInvoice.last_invoice_date)} · ${supplierName(lastInvoice.supplier_id) ?? "—"}`
            : "Ingen fakturalinjer"
        }
      />
      <Kpi
        label={`Avtalepris / ${rm.base_unit}`}
        value={agreed.value != null ? formatNok(agreed.value) : "—"}
        hint={
          agreed.source === "link"
            ? `Primærkobling${agreed.validTo ? ` · gyldig til ${formatDate(agreed.validTo)}` : " · uten sluttdato"}`
            : agreed.source === "raw_material"
              ? "Fra råvarekortet"
              : "Ingen avtalepris"
        }
      />
      <Kpi
        label="Avvik"
        value={deviation.pct != null ? `${deviation.pct > 0 ? "+" : ""}${deviation.pct.toFixed(1)} %` : "—"}
        valueClassName={
          deviation.pct == null
            ? undefined
            : deviation.pct > 5
              ? "text-warning"
              : deviation.pct < -5
                ? "text-success"
                : undefined
        }
        hint={deviation.basis ? `Siste faktura mot ${deviation.basis}` : "Mangler grunnlag"}
      />
      <Kpi
        label="Primærleverandør"
        value={
          primarySupplierId ? (
            <Link
              to={`/ravarer/leverandorer/${primarySupplierId}`}
              className="text-app underline-offset-2 hover:underline"
            >
              <span className="text-lg">{supplierName(primarySupplierId)}</span>
            </Link>
          ) : (
            "—"
          )
        }
        hint={primary?.supplier_sku ? `Lev.nr ${primary.supplier_sku}` : "Ingen leverandør-SKU"}
      />
      <Kpi
        label="Kjøpt 12 mnd"
        value={spend12m != null ? formatNok(spend12m) : "—"}
        hint="Fakturabeløp eks. mva"
      />
      <Kpi
        label="Brukt i oppskrifter"
        value={String(recipeCount)}
        hint={recipeCount === 1 ? "1 oppskrift" : `${recipeCount} oppskrifter`}
      />
    </div>
  );
}
