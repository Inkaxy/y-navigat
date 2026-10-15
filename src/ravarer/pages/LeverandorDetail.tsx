import { useCallback, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { cn } from "@/lib/utils";
import { SupplierStatusBadge } from "@/ravarer/components/supplier/TrackInvoiceToggle";
import { SupplierDialog } from "@/ravarer/components/NewSupplierDialog";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useSupplier } from "@/ravarer/hooks/useSupplierDetail";
import { paths } from "@/ravarer/lib/paths";
import {
  listReturnSearch, readSupplierSection, supplierSectionSearch, SUPPLIER_SECTION_LABEL, type SupplierSectionId,
  SUPPLIER_GROUPS, SUPPLIER_GROUP_LABEL, supplierGroupOf, supplierGroupSection, supplierGroupSections, type SupplierGroup,
} from "@/ravarer/lib/supplierSections";
import { SupplierOverviewSection } from "@/ravarer/components/supplier/SupplierOverviewSection";
import { SupplierItemsSection } from "@/ravarer/components/supplier/SupplierItemsSection";
import { SupplierAgreementsSection } from "@/ravarer/components/supplier/SupplierAgreementsSection";
import { SupplierInvoicesSection } from "@/ravarer/components/supplier/SupplierInvoicesSection";
import { SupplierAliasesSection } from "@/ravarer/components/supplier/SupplierAliasesSection";
import { SupplierNegotiationsSection } from "@/ravarer/components/supplier/SupplierNegotiationsSection";
import { SupplierNotesSection } from "@/ravarer/components/supplier/SupplierNotesSection";

/** Leverandørkortet: samme seksjonsramme som råvarekortet (`?seksjon=`), med listekontekst i `?liste=`. */
export default function LeverandorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { canWrite } = useRavarer();
  const [editOpen, setEditOpen] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const onDirty = useCallback((d: boolean) => setNotesDirty(d), []);
  const guard = useUnsavedChangesGuard(notesDirty);
  const supplier = useSupplier(id);
  const section = readSupplierSection(sp);
  const hrefFor = (s: SupplierSectionId) => `${paths.leverandor(id ?? "")}${supplierSectionSearch(sp, s)}`;
  const backHref = `${paths.leverandorer()}${listReturnSearch(sp)}`;
  const go = (s: SupplierSectionId) => guard.requestAction(() => navigate(hrefFor(s), { replace: true }));

  // Bakgrunnsfeil med bufret leverandør holder kortet (og notatutkastet) montert med synlig feil.
  if (!supplier.data) {
    return (
      <QueryState isLoading={supplier.isLoading} isError={supplier.isError} error={supplier.error} onRetry={() => void supplier.refetch()}
        scope="Leverandøren" isEmpty={!supplier.data} emptyTitle="Fant ikke leverandøren" emptyDescription="Den kan være slettet, eller lenken kan være feil.">
        {null}
      </QueryState>
    );
  }
  const s = supplier.data;
  const listSearch = sp.get("liste") ?? "";
  const group: SupplierGroup = supplierGroupOf(section);

  return (
    <div className="space-y-5">
      {supplier.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <span>Kunne ikke oppdatere leverandøren. Viser sist hentede data; ulagrede notater beholdes.</span>
          <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-9" onClick={() => void supplier.refetch()}>Prøv igjen</Button>
        </div>
      )}
      {/* Én kompakt header: navn, status, kontakt som faktisk er registrert, og handlinger. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-subtle pb-3">
        <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Tilbake til leverandørlisten">
          <Link to={backHref}><ArrowLeft className="h-4 w-4" aria-hidden /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-title [overflow-wrap:anywhere]">{s.name}</h1>
            <SupplierStatusBadge s={s} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 text-caption text-ink-secondary" data-testid="supplier-header-contact">
            {s.contact_email && <a className="inline-flex min-h-[44px] items-center gap-1 hover:underline md:min-h-0" href={`mailto:${s.contact_email}`}><Mail className="h-3.5 w-3.5" aria-hidden />{s.contact_email}</a>}
            {s.contact_phone && <a className="inline-flex min-h-[44px] items-center gap-1 hover:underline md:min-h-0" href={`tel:${s.contact_phone}`}><Phone className="h-3.5 w-3.5" aria-hidden />{s.contact_phone}</a>}
            {!s.contact_email && !s.contact_phone && <span>Ingen kontaktinformasjon registrert</span>}
            {s.org_number && <span>Org.nr {s.org_number}</span>}
          </div>
        </div>
        {canWrite && <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setEditOpen(true)}>Rediger leverandør</Button>}
      </header>
      <SupplierDialog open={editOpen} onOpenChange={setEditOpen} supplier={s} />

      {/* Tre hovedinnganger + «Mer». All navigasjon går gjennom vakten for ulagrede notater. */}
      <nav aria-label="Seksjoner på leverandørkortet" className="space-y-2">
        <div className="flex flex-wrap gap-1" role="tablist">
          {SUPPLIER_GROUPS.map((g) => (
            <button key={g} type="button" role="tab" aria-selected={group === g} onClick={() => go(supplierGroupSection(g))}
              className={cn("min-h-[44px] rounded-md px-3 text-sm", group === g ? "bg-muted font-semibold text-foreground" : "text-ink-secondary hover:bg-muted/60")}>
              {SUPPLIER_GROUP_LABEL[g]}
            </button>
          ))}
        </div>
        {group === "mer" && (
          <div className="flex flex-wrap gap-1 border-l-2 border-line-subtle pl-2" aria-label="Under Mer">
            {supplierGroupSections("mer").map((sid) => (
              <button key={sid} type="button" aria-current={section === sid ? "page" : undefined} onClick={() => go(sid)}
                className={cn("min-h-[44px] rounded-md px-3 text-sm", section === sid ? "bg-muted font-medium text-foreground" : "text-ink-secondary hover:bg-muted/60")}>
                {SUPPLIER_SECTION_LABEL[sid]}
              </button>
            ))}
          </div>
        )}
      </nav>
      <section aria-labelledby="supplier-section-title" className="min-w-0 space-y-4">
        <h2 id="supplier-section-title" className="sr-only">{SUPPLIER_SECTION_LABEL[section]}</h2>
        {section === "oversikt" && <SupplierOverviewSection supplier={s} />}
        {section === "varer" && <SupplierItemsSection supplier={s} />}
        {section === "avtaler" && <SupplierAgreementsSection supplier={s} />}
        {section === "fakturaer" && <SupplierInvoicesSection supplierId={s.id} listSearch={listSearch} />}
        {section === "aliaser" && <SupplierAliasesSection supplierId={s.id} />}
        {section === "forhandlinger" && <SupplierNegotiationsSection supplierId={s.id} />}
        {section === "notater" && <SupplierNotesSection supplier={s} canWrite={canWrite} onDirtyChange={onDirty} />}
      </section>
      <UnsavedChangesDialog {...guard.dialogProps} />
    </div>
  );
}
