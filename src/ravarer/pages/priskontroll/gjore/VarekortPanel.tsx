import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { savePrimaryAndRefresh } from "@/ravarer/lib/primaryChoice";
import { paths } from "@/ravarer/lib/paths";
import { ResultBox } from "@/ravarer/ui/ResultBox";
import { VarekortHeaderView, VBlock } from "./VarekortHeaderView";
import { PriceBlock, hasPriceWork } from "./PriceBlock";
import { packageConflict, packageLabel } from "./packageLabel";
import { ChangeLinkDialog } from "./ChangeLinkDialog";
import { SupplierLinkAliases } from "./SupplierLinkAliases";
import type { PanelResult } from "./types";
import { LineInsightPanel } from "@/fakturaer/components/inbox/task/LineInsightPanel";
import { insightLineFromSupplierItem, lineClarifications } from "@/fakturaer/lib/lineInsight";

type Props = {
  supplierId: string;
  itemKey: string;
  /** Kalles når en handling lyktes (arbeidsflaten fjerner elementet og finner neste). */
  onDone?: (r: PanelResult) => void;
  onNext?: () => void;
  onSkip?: () => void;
  onClose?: () => void;
  /** Arbeidsbordet: linjen originalpanelet viser, og varsling når brukeren velger en annen faktura. */
  originalLineId?: string | null;
  onOriginalLine?: (lineId: string) => void;
};

/** Varekortet: alle beslutninger om én leverandørvare. Brukes i arbeidsflaten, på fullside og i Sheet. */
export function VarekortPanel({ supplierId, itemKey, onDone, onNext, onSkip, onClose, originalLineId, onOriginalLine }: Props) {
  const q = useSupplierItems({ supplierId, itemKey, pageSize: 1 });
  const lines = useSupplierItemLines(supplierId, itemKey);
  const { canWrite } = useInvoiceRights();
  const [result, setResult] = useState<PanelResult | null>(null);
  const live = q.data?.items[0] ?? null;
  // Frys: det brukeren jobber med endrer seg ikke under hånden. Nye data vises som varsel med «Oppdater».
  const [snap, setSnap] = useState<{ item: SupplierItem; lines: SupplierItemLine[] } | null>(null);
  useEffect(() => {
    if (!snap && live && lines.data) setSnap({ item: live, lines: lines.data });
  }, [snap, live, lines.data]);
  const change = snap && live && lines.data ? frozenChange(snap.lines, lines.data, snap.item, live) : null;
  const item = snap?.item ?? live;
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
        <>
        {change && (
          <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <span>{change}</span>
            <Button size="sm" variant="outline" onClick={() => setSnap(live && lines.data ? { item: live, lines: lines.data } : null)}>Oppdater</Button>
          </div>
        )}
        <VarekortBody key={`${item.supplier_id}|${item.item_key}`} originalLineId={originalLineId ?? null} item={item} lines={snap?.lines ?? lines.data ?? []} canWrite={canWrite} stale={!!change}
          onDone={done} onNext={onNext} onSkip={onSkip} onClose={onClose ?? (() => undefined)} />
        {onOriginalLine && <OriginalPicker lines={snap?.lines ?? lines.data ?? []} current={originalLineId ?? item.last_open_line_id ?? null} onPick={onOriginalLine} />}
        </>
      )}
    </QueryState>
  );
}

/** Velg hvilken faktura originalpanelet skal vise — én knapp per faktura i varekortets linjer, åpne først. */
function OriginalPicker({ lines, current, onPick }: { lines: SupplierItemLine[]; current: string | null; onPick: (lineId: string) => void }) {
  const byInvoice = new Map<string, SupplierItemLine>();
  for (const l of [...lines].sort((a, b) => Number(!!b.requires_review) - Number(!!a.requires_review))) if (!byInvoice.has(l.invoice_id)) byInvoice.set(l.invoice_id, l);
  const opts = [...byInvoice.values()];
  if (opts.length < 2) return null;
  const curInvoice = lines.find((l) => l.id === current)?.invoice_id ?? null;
  return (
    <nav aria-label="Vis original for faktura" className="mt-4 border-t border-line-subtle pt-3">
      <p className="mb-1 text-caption text-ink-secondary">Originalen viser faktura:</p>
      <div className="flex flex-wrap gap-1.5">
        {opts.map((l) => {
          const on = l.invoice_id === curInvoice;
          return (
            <Button key={l.invoice_id} size="sm" variant={on ? "secondary" : "outline"} className="min-h-[44px]" aria-pressed={on} onClick={() => onPick(l.id)}>
              {l.invoice_number ? `Faktura ${l.invoice_number}` : "Faktura uten nummer"}{l.invoice_date ? ` · ${l.invoice_date.split("-").reverse().join(".")}` : ""}{l.requires_review ? " · åpen" : ""}
            </Button>
          );
        })}
      </div>
    </nav>
  );
}

/** Hva har endret seg siden varekortet ble åpnet? null = ingenting som påvirker beslutningen. */
export function frozenChange(before: readonly SupplierItemLine[], after: readonly SupplierItemLine[], bi: SupplierItem, ai: SupplierItem): string | null {
  const open = (ls: readonly SupplierItemLine[]) => new Set(ls.filter((l) => l.requires_review).map((l) => l.id));
  const b = open(before); const a = open(after);
  const added = [...a].filter((id) => !b.has(id)).length;
  const removed = [...b].filter((id) => !a.has(id)).length;
  const parts: string[] = [];
  if (added) parts.push(`${added} ${added === 1 ? "ny åpen linje" : "nye åpne linjer"}`);
  if (removed) parts.push(`${removed} ${removed === 1 ? "linje er" : "linjer er"} løst et annet sted`);
  if (bi.status !== ai.status || bi.rm_id !== ai.rm_id) parts.push("koblingen eller statusen er endret");
  return parts.length ? `Varekortet er endret siden du åpnet det: ${parts.join(", ")}.` : null;
}

function VarekortBody({ item, lines, canWrite, stale, onDone, onNext, onSkip, onClose, originalLineId }: {
  originalLineId?: string | null; item: SupplierItem; lines: SupplierItemLine[]; canWrite: boolean; stale?: boolean;
  onDone: (r: PanelResult) => void; onNext?: () => void; onSkip?: () => void; onClose: () => void;
}) {
  const { data: company } = useCompany();
  const link = useLinkSupplierItem();
  const linked = !!item.rm_id && item.status !== "ukoblet";
  const pkgOk = linked && item.status !== "mangler_pakning";
  // «kontroll» (sku-kollisjon, uavklart, uleselig) løses ved å koble på nytt.
  const [editForm, setEditForm] = useState(!pkgOk || item.status === "kontroll");
  const [menuOpen, setMenuOpen] = useState(false);
  const [primarySaving, setPrimarySaving] = useState(false);
  const qc = useQueryClient();
  const [editPkg, setEditPkg] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [primary, setPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = openScope(lines);
  // Linjeinnsikt for den valgte originallinjen (ellers siste åpne). Bare visning — sperrer bare via eksisterende prisgates.
  const insightSrc = lines.find((l) => l.id === (originalLineId ?? item.last_open_line_id)) ?? scope.lastOpen ?? lines[0] ?? null;
  const insightLine = insightSrc ? insightLineFromSupplierItem(item, insightSrc) : null;
  const priceWork = hasPriceWork(item, lines);
  // Bare når koblingens varenummer er varekortets — ellers kan rms_id være en annen leverandørvare.
  const canMoveLink = item.rms_sku_matches === true && !!item.rms_id;

  const onLinkDone = (r: Parameters<NonNullable<React.ComponentProps<typeof SupplierItemLinkForm>["onDone"]>>[0]) => {
    onDone({ title: "Varekortet er oppdatert", items: linkResultSummary(r) });
  };
  const notItem = async (reason: string) => {
    if (!company) return;
    setError(null);
    try {
      // Bare linjene som vises (fryst utvalg) — nye linjer krever «Oppdater» først.
      const lineIds = lines.filter((l) => l.requires_review).map((l) => l.id);
      if (lineIds.length === 0) { setError("Ingen åpne linjer i utvalget. Trykk «Oppdater» først."); return; }
      const r = await link.mutateAsync({ legal_entity_id: company.id, supplier_id: item.supplier_id, item_key: item.item_key, not_raw_material: true, reason, line_ids: lineIds });
      onDone({ title: `Merket som ikke vare (${reason})`, items: linkResultSummary(r) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke lagre.");
    }
  };
  const savePrimary = async (): Promise<boolean> => {
    if (!primary || !item.rm_id) return true;
    setPrimarySaving(true);
    try {
      await savePrimaryAndRefresh(qc, true, item);
      setPrimary(false);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke sette primær leverandør.");
      return false;
    } finally { setPrimarySaving(false); }
  };
  const finish = async () => {
    setError(null);
    if (!(await savePrimary())) return;
    if (onNext) onNext(); else onClose();
  };

  return (
    <div className="space-y-6">
      <VarekortHeaderView item={item} openInvoices={scope.invoices} />
      {insightSrc && lines.length > 1 && (
        <p className="text-sm font-medium" data-testid="valgt-faktura">Valgt faktura {insightSrc.invoice_number ?? "uten nummer"}{insightSrc.invoice_date ? ` · ${insightSrc.invoice_date.split("-").reverse().join(".")}` : ""}{insightSrc.is_credit_note ? " · kreditnota" : ""}</p>
      )}
      {insightLine && <LineInsightPanel line={insightLine} clarifications={lineClarifications(insightLine)} />}

      {editForm ? (
        <SupplierItemLinkForm item={item} lines={lines} canWrite={canWrite} onDone={onLinkDone} onClose={onClose} onNext={onNext}
          onCreateNew={() => setCreateOpen(true)} startEditingPackage={editPkg} />
      ) : (
        <>
          <VBlock n={1} title="Råvare" done summary={
            <span className="flex flex-wrap items-center gap-2">
              <Link className="font-medium underline underline-offset-2" to={paths.raavare(item.rm_id)}>{item.rm_name ?? "Råvare"}</Link>
              <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => (canMoveLink ? setChangeOpen(true) : setEditForm(true))}>Endre kobling</Button>
            </span>
          } />
          <VBlock n={2} title="Pakning" done summary={
            <span className="flex flex-wrap items-center gap-2 text-ink-secondary">
              {packageLabel(item)}
              {packageConflict(item) && <span className="text-caption text-warning">{packageConflict(item)}</span>}
              <Button data-action="check-package" size="sm" variant="ghost" disabled={!canWrite} onClick={() => { setEditPkg(true); setEditForm(true); }}>Endre</Button>
            </span>
          } />
        </>
      )}

      {priceWork && linked && (
        <VBlock n={3} title="Pris">
          <PriceBlock item={item} lines={lines} canWrite={canWrite} onDone={onDone} selectedInvoiceId={originalLineId ? insightSrc?.invoice_id ?? null : null} onCheckPackage={() => { setEditPkg(true); setEditForm(true); }} />
        </VBlock>
      )}

      {!editForm && (
        <VBlock n={4} title="Gjelder">
          <p className="text-sm">{scope.lines} åpne {scope.lines === 1 ? "linje" : "linjer"} på {scope.invoices} {scope.invoices === 1 ? "faktura" : "fakturaer"}</p>
          {!item.is_primary && (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={primary} onCheckedChange={(v) => setPrimary(v === true)} disabled={!canWrite} />Sett som primær leverandør for råvaren</label>
          )}
          {!item.is_primary && priceWork && primary && (
            <Button size="sm" variant="outline" disabled={!canWrite || primarySaving} onClick={() => { setError(null); void savePrimary(); }}>Lagre primær leverandør</Button>
          )}
        </VBlock>
      )}

      {stale && <p className="text-caption text-ink-secondary">Handlinger gjelder linjene som vises. Trykk «Oppdater» for å ta med nye linjer.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!canWrite && <p className="text-caption text-ink-secondary">Du har bare lesetilgang.</p>}

      {!editForm && (
        // Med prisarbeid ligger hovedhandlingene i Pris-blokken; da skal ikke «Ikke vare …» være eneste klebrige handling.
        <div className={`${priceWork ? "" : "sticky bottom-0 z-10 "}-mx-4 flex flex-wrap items-center gap-2 border-t border-line-subtle bg-card px-4 py-3 [&>button]:min-h-11`}>
          {!priceWork && <Button data-primary-action disabled={(!canWrite && primary) || primarySaving} onClick={() => void finish()}>Ferdig — neste</Button>}
          {/* Hurtigtast X: Radix åpner ikke på .click(), så menyen styres direkte. */}
          <button type="button" hidden data-action="not-item" disabled={!canWrite || link.isPending} onClick={() => setMenuOpen(true)} />
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild><Button variant="ghost" className="min-h-11" disabled={!canWrite || link.isPending}>Ikke vare …</Button></DropdownMenuTrigger>
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
          context={{ kind: "supplier_item", supplierId: item.supplier_id, itemKey: item.item_key, inferLineId: (lines.find((l) => l.requires_review) ?? lines[0])?.id ?? item.last_open_line_id ?? item.last_line_id ?? null, lineUnit: (lines.find((l) => l.requires_review) ?? lines[0])?.unit ?? null, prefill: { name: item.description ?? undefined, sku: item.supplier_sku ?? "", supplierId: item.supplier_id } }}
          onDone={(_id, outcome) => onDone({ title: "Råvare opprettet og koblet", items: outcome.kind === "linked" ? linkResultSummary(outcome.result) : [] })}
        />
      )}
    </div>
  );
}
