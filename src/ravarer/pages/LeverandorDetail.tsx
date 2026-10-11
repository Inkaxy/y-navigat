import { useCallback, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryState } from "@/components/common/QueryState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { cn } from "@/lib/utils";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { SupplierDialog } from "@/ravarer/components/NewSupplierDialog";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useSupplier } from "@/ravarer/hooks/useSupplierDetail";
import { paths } from "@/ravarer/lib/paths";
import {
  listReturnSearch, readSupplierSection, supplierSectionSearch, SUPPLIER_SECTION_LABEL, SUPPLIER_SECTIONS, type SupplierSectionId,
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

  return (
    <div className="space-y-5">
      {supplier.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <span>Kunne ikke oppdatere leverandøren. Viser sist hentede data; ulagrede notater beholdes.</span>
          <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-9" onClick={() => void supplier.refetch()}>Prøv igjen</Button>
        </div>
      )}
      <RavarerHeaderBanner
        title={s.name}
        subtitle="Leverandørkort"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-9" onClick={() => setEditOpen(true)}>Rediger leverandør</Button>}
            <Button asChild variant="outline" size="sm" className="min-h-[44px] gap-1.5 md:min-h-9">
              <Link to={backHref}><ArrowLeft className="h-4 w-4" aria-hidden />Tilbake til listen</Link>
            </Button>
          </div>
        }
      />
      <SupplierDialog open={editOpen} onOpenChange={setEditOpen} supplier={s} />

      <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Seksjoner på leverandørkortet" className="hidden lg:block">
          <ul className="sticky top-4 space-y-0.5">
            {SUPPLIER_SECTIONS.map((sid) => (
              <li key={sid}>
                <Link to={hrefFor(sid)} replace aria-current={section === sid ? "page" : undefined}
                  className={cn("flex min-h-10 items-center rounded-md px-3 text-sm transition-colors", section === sid ? "bg-muted font-semibold text-foreground" : "text-ink-secondary hover:bg-muted/60")}>
                  {SUPPLIER_SECTION_LABEL[sid]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="lg:hidden">
          <Select value={section} onValueChange={(v) => go(v as SupplierSectionId)}>
            <SelectTrigger className="h-[44px]" aria-label="Velg seksjon"><SelectValue /></SelectTrigger>
            <SelectContent>{SUPPLIER_SECTIONS.map((sid) => <SelectItem key={sid} value={sid}>{SUPPLIER_SECTION_LABEL[sid]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <section aria-labelledby="supplier-section-title" className="min-w-0 space-y-4">
          <h2 id="supplier-section-title" className="font-display text-title">{SUPPLIER_SECTION_LABEL[section]}</h2>
          {section === "oversikt" && <SupplierOverviewSection supplier={s} />}
          {section === "varer" && <SupplierItemsSection supplier={s} />}
          {section === "avtaler" && <SupplierAgreementsSection supplier={s} />}
          {section === "fakturaer" && <SupplierInvoicesSection supplierId={s.id} listSearch={listSearch} />}
          {section === "aliaser" && <SupplierAliasesSection supplierId={s.id} />}
          {section === "forhandlinger" && <SupplierNegotiationsSection supplierId={s.id} />}
          {section === "notater" && <SupplierNotesSection supplier={s} canWrite={canWrite} onDirtyChange={onDirty} />}
        </section>
      </div>
      <UnsavedChangesDialog {...guard.dialogProps} />
    </div>
  );
}
