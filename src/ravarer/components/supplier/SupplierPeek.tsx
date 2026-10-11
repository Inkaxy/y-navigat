import { Link } from "react-router-dom";
import { PeekPanel } from "@/ravarer/ui/SplitView";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { paths } from "@/ravarer/lib/paths";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";
import { SupplierStatusBadge, TrackInvoiceToggle } from "./TrackInvoiceToggle";

/** Fullt leverandørkort med listekontekst, så «Tilbake» gjenoppretter søk/filter/valgt. */
export const supplierFullHref = (id: string, listSearch: string, seksjon?: string) => {
  const q = new URLSearchParams();
  if (seksjon) q.set("seksjon", seksjon);
  if (listSearch) q.set("liste", listSearch);
  const s = q.toString();
  return `${paths.leverandor(id)}${s ? `?${s}` : ""}`;
};

export function SupplierPeek({ supplier, listSearch, canWrite, onClose }: { supplier: SupplierRow | null; listSearch: string; canWrite: boolean; onClose: () => void }) {
  return (
    <PeekPanel title={supplier?.name} fullHref={supplier ? supplierFullHref(supplier.id, listSearch) : undefined} onClose={supplier ? onClose : undefined} emptyText="Velg en leverandør i listen">
      {supplier ? (
        <div className="space-y-4" data-testid="supplier-peek">
          <div className="flex flex-wrap items-center gap-2"><SupplierStatusBadge s={supplier} />{supplier.org_number && <span className="font-mono text-caption text-ink-secondary">Org.nr {supplier.org_number}</span>}</div>
          <dl className="grid gap-2 text-sm">
            <div><dt className="text-caption text-ink-secondary">E-post</dt><dd className="[overflow-wrap:anywhere]">{supplier.contact_email ? <a className="inline-flex min-h-[44px] items-center text-primary hover:underline xl:min-h-0" href={`mailto:${supplier.contact_email}`}>{supplier.contact_email}</a> : "—"}</dd></div>
            <div><dt className="text-caption text-ink-secondary">Telefon</dt><dd>{supplier.contact_phone ? <a className="inline-flex min-h-[44px] items-center text-primary hover:underline xl:min-h-0" href={`tel:${supplier.contact_phone}`}>{supplier.contact_phone}</a> : "—"}</dd></div>
            <div><dt className="text-caption text-ink-secondary">Fakturaer</dt><dd>{supplier.invoice_count != null ? formatNumber(supplier.invoice_count, 0) : "—"} · siste {formatDate(supplier.last_invoice_date)}</dd></div>
          </dl>
          <div className="flex items-center gap-2 text-sm"><TrackInvoiceToggle supplier={supplier} canWrite={canWrite} /><span>Følg fakturalinjer</span></div>
          <ul className="grid gap-1 text-sm">
            {(["varer", "avtaler", "fakturaer", "aliaser"] as const).map((s) => (
              <li key={s}><Link to={supplierFullHref(supplier.id, listSearch, s)} className="inline-flex min-h-[44px] items-center text-primary hover:underline xl:min-h-0">{s[0].toUpperCase() + s.slice(1)}</Link></li>
            ))}
          </ul>
        </div>
      ) : null}
    </PeekPanel>
  );
}
