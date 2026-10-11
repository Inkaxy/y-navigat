import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { QueryState } from "@/components/common/QueryState";
import { useCompany } from "@/hooks/useCompany";
import { useLinkSupplierItem, useSupplierItemLines, useSupplierItems } from "@/fakturaer/hooks/useSupplierItems";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { openScope } from "@/fakturaer/lib/linkFormLogic";
import { linkResultSummary, type SupplierItem, type SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { SupplierItemLinkForm } from "@/fakturaer/components/supplier-item/SupplierItemLinkForm";
import { SupplierItemHistory } from "@/fakturaer/components/supplier-item/SupplierItemHistory";
import { AuditHistory } from "@/fakturaer/components/decisions/AuditHistory";
import { RawMaterialCreateSheet } from "@/ravarer/editors/RawMaterialCreateSheet";
import { NOT_A_PRODUCT_REASONS } from "@/ravarer/lib/notAProductReasons";
import { setPrimarySupplier } from "@/ravarer/lib/supplierLinkRpc";
import { paths } from "@/ravarer/lib/paths";
import { ResultBox } from "@/ravarer/ui/ResultBox";
import { VarekortHeaderView, VBlock } from "./VarekortHeaderView";
import { PriceBlock, hasPriceWork } from "./PriceBlock";
import { ChangeLinkDialog } from "./ChangeLinkDialog";
import { SupplierLinkAliases } from "./SupplierLinkAliases";
import type { PanelResult } from "./types";

type Props = {
  supplierId: string;
  itemKey: string;
  /** Kalles når en handling lyktes (arbeidsflaten fjerner elementet og finner neste). */
  onDone?: (r: PanelResult) => void;
  onNext?: () => void;
  onSkip?: () => void;
  onClose?: () => void;
};

/** Varekortet: alle beslutninger om én leverandørvare. Brukes i arbeidsflaten, på fullside og i Sheet. */
export function VarekortPanel({ supplierId, itemKey, onDone, onNext, onSkip, onClose }: Props) {
  const q = useSupplierItems({ supplierId, itemKey, pageSize: 1 });
  const lines = useSupplierItemLines(supplierId, itemKey);
  const { canWrite } = useInvoiceRights();
  const [result, setResult] = useState<PanelResult | null>(null);
  const item = q.data?.items[0] ?? null;
  const done = (r: PanelResult) => { setResult(r); onDone?.(r); };

  if (result) {
    return (
      <ResultBox title={result.title} items={result.items} onNext={onNext}>
        {result.link && <Link className="underline underline-offset-2" to={result.link.to}>{result.link.label}</Link>}
        {!onNext && onClose && <button type="button" className="ml-3 underline underline-offset-2" onClick={onClose}>Lukk</button>}
      </ResultBox>
    );
  }
  return (
    <QueryState isLoading={q.isLoading || lines.isLoading} isError={q.isError || lines.isError} error={q.error ?? lines.error} scope="ravarer:varekort"
      onRetry={() => { void q.refetch(); void lines.refetch(); }} isEmpty={!item} emptyTitle="Fant ikke varekortet">
      {item && (
        <VarekortBody key={`${item.supplier_id}|${item.item_key}`} item={item} lines={lines.data ?? []} canWrite={canWrite}
          onDone={done} onNext={onNext} onSkip={onSkip} onClose={onClose ?? (() => undefined)} />
      )}
    </QueryState>
  );
}

function VarekortBody({ item, lines, canWrite, onDone, onNext, onSkip, onClose }: {
  item: SupplierItem; lines: SupplierItemLine[]; canWrite: boolean;
  onDone: (r: PanelResult) => void; onNext?: () => void; onSkip?: () => void; onClose: () => void;
}) {
  const { data: company } = useCompany();
  const link = useLinkSupplierItem();
  const linked = !!item.rm_id && item.status !== "ukoblet";
  const pkgOk = linked && item.status !== "mangler_pakning";
  const [editForm, setEditForm] = useState(!pkgOk);
  const [editPkg, setEditPkg] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [primary, setPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = openScope(lines);
  const priceWork = hasPriceWork(item, lines);
  const skuKey = item.item_key.startsWith("sku:") && !!item.rms_id;

  const onLinkDone = (r: Parameters<NonNullable<React.ComponentProps<typeof SupplierItemLinkForm>["onDone"]>>[0]) => {
    onDone({ title: "Varekortet er oppdatert", items: linkResultSummary(r) });
  };
  const notItem = async (reason: string) => {
    if (!company) return;
    setError(null);
    try {
      const r = await link.mutateAsync({ legal_entity_id: company.id, supplier_id: item.supplier_id, item_key: item.item_key, not_raw_material: true, reason });
      onDone({ title: `Merket som ikke vare (${reason})`, items: linkResultSummary(r) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke lagre.");
    }
  };
  const finish = async () => {
    setError(null);
    if (primary && item.rm_id) {
      try { await setPrimarySupplier(item.rm_id, item.supplier_id); } catch (e) { setError(e instanceof Error ? e.message : "Kunne ikke sette primær leverandør."); return; }
    }
    onNext?.();
  };

  return (
    <div className="space-y-6">
      <VarekortHeaderView item={item} openInvoices={scope.invoices} />

      {editForm ? (
        <SupplierItemLinkForm item={item} lines={lines} canWrite={canWrite} onDone={onLinkDone} onClose={onClose} onNext={onNext}
          onCreateNew={() => setCreateOpen(true)} startEditingPackage={editPkg} />
      ) : (
        <>
          <VBlock n={1} title="Råvare" done summary={
            <span className="flex flex-wrap items-center gap-2">
              <Link className="font-medium underline underline-offset-2" to={paths.raavare(item.rm_id)}>{item.rm_name ?? "Råvare"}</Link>
              <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => (skuKey ? setChangeOpen(true) : setEditForm(true))}>Endre kobling</Button>
            </span>
          } />
          <VBlock n={2} title="Pakning" done summary={
            <span className="flex flex-wrap items-center gap-2 text-ink-secondary">
              {item.base_units_per_package != null ? `${item.base_units_per_package.toLocaleString("nb-NO")} ${item.rm_base_unit ?? ""} per ${item.package_unit ?? "pakning"}` : "Regnes direkte fra fakturaenheten"}
              <Button data-action="check-package" size="sm" variant="ghost" disabled={!canWrite} onClick={() => { setEditPkg(true); setEditForm(true); }}>Endre</Button>
            </span>
          } />
        </>
      )}

      {priceWork && linked && (
        <VBlock n={3} title="Pris">
          <PriceBlock item={item} lines={lines} canWrite={canWrite} onDone={onDone} onCheckPackage={() => { setEditPkg(true); setEditForm(true); }} />
        </VBlock>
      )}

      {!editForm && (
        <VBlock n={4} title="Gjelder">
          <p className="text-sm">{scope.lines} åpne {scope.lines === 1 ? "linje" : "linjer"} på {scope.invoices} {scope.invoices === 1 ? "faktura" : "fakturaer"}</p>
          {!item.is_primary && (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={primary} onCheckedChange={(v) => setPrimary(v === true)} disabled={!canWrite} />Sett som primær leverandør for råvaren</label>
          )}
        </VBlock>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!canWrite && <p className="text-caption text-ink-secondary">Du har bare lesetilgang.</p>}

      {!editForm && (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-line-subtle bg-card px-4 py-3">
          {!priceWork && <Button data-primary-action disabled={!canWrite && primary} onClick={() => void finish()}>Ferdig — neste</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button data-action="not-item" variant="ghost" disabled={!canWrite || link.isPending}>Ikke vare …</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              {NOT_A_PRODUCT_REASONS.map((r) => <DropdownMenuItem key={r} onSelect={() => void notItem(r)}>{r}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          {onSkip && <Button variant="ghost" onClick={onSkip}>Hopp over</Button>}
        </div>
      )}
      {editForm && onSkip && <button type="button" className="text-caption text-ink-secondary underline underline-offset-2" onClick={onSkip}>Hopp over</button>}

      <details className="rounded-md border border-line-subtle p-3">
        <summary className="cursor-pointer text-sm font-semibold">Aliaser og historikk</summary>
        <div className="mt-3 space-y-4">
          {item.rms_id && <section><h4 className="mb-1 text-caption font-semibold text-ink-secondary">Aliaser</h4><SupplierLinkAliases rmsId={item.rms_id} /></section>}
          {item.rms_id && <section><h4 className="mb-1 text-caption font-semibold text-ink-secondary">Endringer på koblingen</h4><AuditHistory entityId={item.rms_id} kind="supplier_link" /></section>}
          <section>
            <h4 className="mb-1 text-caption font-semibold text-ink-secondary">Linjer</h4>
            {lines.length === 0 ? <p className="text-sm text-ink-secondary">Ingen linjer funnet.</p> : <SupplierItemHistory lines={lines} baseUnit={item.rm_base_unit} />}
          </section>
        </div>
      </details>

      <ChangeLinkDialog open={changeOpen} onOpenChange={setChangeOpen} item={item} lines={lines} onDone={onDone} />
      {createOpen && (
        <RawMaterialCreateSheet open={createOpen} onOpenChange={setCreateOpen}
          context={{ kind: "supplier_item", supplierId: item.supplier_id, itemKey: item.item_key, lineIds: lines.filter((l) => l.requires_review).map((l) => l.id), prefill: { name: item.description ?? undefined, supplierId: item.supplier_id } }}
          onDone={(_id, outcome) => onDone({ title: "Råvare opprettet og koblet", items: outcome.kind === "linked" ? linkResultSummary(outcome.result) : [] })}
        />
      )}
    </div>
  );
}
