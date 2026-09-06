import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Loader2, AlertTriangle, Check, ChevronsUpDown, FileText } from "lucide-react";

import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { useReviewLines, type ReviewLineRow, type ReviewReason } from "@/fakturaer/hooks/useReviewLines";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { formatNok, formatDate } from "@/fakturaer/lib/constants";
import { MatchDrawer } from "@/fakturaer/components/MatchDrawer";
import { CreateRawMaterialDialog } from "@/fakturaer/components/CreateRawMaterialDialog";
import { NotARawMaterialDialog } from "@/fakturaer/components/NotARawMaterialDialog";
import { SkuConflictDialog } from "@/fakturaer/components/SkuConflictDialog";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMatchTolerances } from "@/fakturaer/hooks/useMatchTolerances";
import { BulkAcceptSuggestionsDialog } from "@/fakturaer/components/BulkAcceptSuggestionsDialog";
import { cn } from "@/lib/utils";

const TABS: { value: ReviewReason; label: string }[] = [
  { value: "unmatched", label: "Umatchet" },
  { value: "low_confidence", label: "Lav tillit" },
  { value: "price_variance", label: "Prisavvik" },
  { value: "price_increase", label: "Prisøkning" },
  { value: "unknown_package_size", label: "Ukjent pakningsstørrelse" },
  { value: "sku_collision", label: "Konflikter" },
  { value: "no_baseline", label: "Uten avtalepris" },
];

const REASON_LABELS: Record<string, string> = {
  unmatched: "Umatchet",
  low_confidence: "Lav tillit",
  price_variance: "Prisavvik",
  price_increase: "Prisøkning",
  unknown_package_size: "Ukjent pakningsstørrelse",
  sku_collision: "Konflikt",
  no_baseline: "Uten avtalepris",
};

const LS_OPEN = "nbhub.faktura.docpanel.open";
const LS_SIZE = "nbhub.faktura.docpanel.size";

/** Alle årsakene på en linje — review_reason er kommaseparert. */
function reasonsOf(line: ReviewLineRow): string[] {
  return (line.review_reason ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Hører linjen hjemme under fanen? Vi sjekker om årsaken FINNES blant verdiene,
 * ikke bare den første. «Uten avtalepris» er en egen arbeidsliste basert på
 * variance_status for linjer som allerede er matchet.
 */
function matchesTab(line: ReviewLineRow, tab: ReviewReason): boolean {
  if (tab === "no_baseline") return line.variance_status === "no_baseline" && !!line.raw_material_id;
  const reasons = reasonsOf(line);
  if (reasons.includes(tab)) return true;
  // Linjer uten kjent årsak vises under «Umatchet» slik at ingenting forsvinner.
  if (tab === "unmatched" && line.requires_review && reasons.every((r) => !TABS.some((t) => t.value === r))) return true;
  return false;
}

export default function FakturaerReviewQueuePage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { data: entities = [] } = useFakturaerLegalEntities();
  const [legalEntityId, setLegalEntityId] = useState<string>("all");
  const [supplierId, setSupplierId] = useState<string>("all");
  const [supplierOpen, setSupplierOpen] = useState(false);

  const [tab, setTab] = useState<ReviewReason>("unmatched");

  const { data: suppliers = [] } = useSuppliersFor(legalEntityId === "all" ? null : legalEntityId);

  const { data: reviewData, isLoading } = useReviewLines({
    legalEntityId: legalEntityId === "all" ? null : legalEntityId,
    supplierId: supplierId === "all" ? null : supplierId,
  });
  const lines = reviewData?.rows ?? [];
  const totalCount = reviewData?.totalCount ?? lines.length;
  const hiddenCount = reviewData?.hiddenCount ?? 0;

  const counts = useMemo(() => {
    const c = {} as Record<ReviewReason, number>;
    TABS.forEach((t) => { c[t.value] = lines.filter((l) => matchesTab(l, t.value)).length; });
    return c;
  }, [lines]);

  const filteredLines = useMemo(() => lines.filter((l) => matchesTab(l, tab)), [lines, tab]);

  // Reelle toleranser fra innstillingene (kategori-override → default → 5 %).
  const toleranceEntityId = legalEntityId !== "all" ? legalEntityId : entities.length === 1 ? entities[0].id : null;
  const { toleranceFor } = useMatchTolerances(toleranceEntityId);

  // Masse-godkjenning av forslag i «Lav tillit»
  const [bulkThreshold, setBulkThreshold] = useState("90");
  const [bulkOpen, setBulkOpen] = useState(false);
  const bulkCandidates = useMemo(() => {
    const min = Number(bulkThreshold) / 100;
    return lines
      .filter((l) => matchesTab(l, "low_confidence"))
      .filter((l) => (l.suggestions?.[0]?.confidence ?? 0) >= min);
  }, [lines, bulkThreshold]);

  // Action dialogs
  const [activeLine, setActiveLine] = useState<ReviewLineRow | null>(null);
  const [matchOpen, setMatchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [notRmOpen, setNotRmOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);

  // Dokumentpanel
  const [docOpen, setDocOpen] = useState<boolean>(() => localStorage.getItem(LS_OPEN) === "1");
  const [docLineId, setDocLineId] = useState<string | null>(null);
  const [panelSize] = useState<number>(() => Number(localStorage.getItem(LS_SIZE)) || 42);

  useEffect(() => { localStorage.setItem(LS_OPEN, docOpen ? "1" : "0"); }, [docOpen]);

  const docLine = useMemo(
    () => lines.find((l) => l.id === docLineId) ?? null,
    [lines, docLineId],
  );

  function open(action: "match" | "create" | "not_rm" | "conflict", line: ReviewLineRow) {
    setActiveLine(line);
    setMatchOpen(action === "match");
    setCreateOpen(action === "create");
    setNotRmOpen(action === "not_rm");
    setConflictOpen(action === "conflict");
  }

  const showDoc = useCallback((line: ReviewLineRow) => {
    setDocLineId(line.id);
    setDocOpen(true);
  }, []);

  // Esc lukker panelet, piltaster flytter aktiv linje innenfor gjeldende fane.
  useEffect(() => {
    if (!docOpen) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") { setDocOpen(false); return; }
      if (typing) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = filteredLines.findIndex((l) => l.id === docLineId);
      const next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
      const target = filteredLines[next < 0 ? 0 : next] ?? filteredLines[idx];
      if (target) setDocLineId(target.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docOpen, docLineId, filteredLines]);

  const tabsEl = (
    <Tabs value={tab} onValueChange={(v) => setTab(v as ReviewReason)}>
      <TabsList className="flex-wrap">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label} ({counts[t.value] ?? 0})
          </TabsTrigger>
        ))}
      </TabsList>
      {TABS.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          <Card className="overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center p-12 text-ink-secondary">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
              </div>
            ) : filteredLines.length === 0 ? (
              <div className="p-12 text-center text-sm text-ink-secondary">Ingenting her — godt jobbet!</div>
            ) : (
              <>
                {t.value === "low_confidence" && (
                  <div className="flex flex-wrap items-center gap-3 border-b border-line-subtle bg-muted/20 px-4 py-3">
                    <span className="text-sm text-ink-secondary">Godta alle forslag over</span>
                    <Select value={bulkThreshold} onValueChange={setBulkThreshold}>
                      <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["80", "85", "90", "95"].map((v) => (
                          <SelectItem key={v} value={v}>{v} %</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" disabled={bulkCandidates.length === 0} onClick={() => setBulkOpen(true)}>
                      Godta {bulkCandidates.length} linjer
                    </Button>
                  </div>
                )}
              <ReviewTable
                lines={filteredLines}
                toleranceFor={toleranceFor}
                reason={t.value}
                onAction={open}
                onOpenInvoice={(id) => navigate(`/ravarer/fakturaer/${id}`)}
                onShowDocument={showDoc}
                docOpen={docOpen}
                activeLineId={docLineId}
              />
              </>
            )}
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  );

  const docPanel = docLine ? (
    <InvoiceDocumentPanel
      invoice={{
        invoice_number: docLine.invoice.invoice_number,
        invoice_date: docLine.invoice.invoice_date,
        supplier_name: docLine.invoice.supplier?.name ?? null,
        source_document_url: docLine.invoice.source_document_url,
        total_amount: docLine.invoice.total_amount,
        total_vat: docLine.invoice.total_vat,
        lines_sum_status: docLine.invoice.lines_sum_status,
        lines_sum_excl_vat: docLine.invoice.lines_sum_excl_vat,
        lines_sum_variance_pct: docLine.invoice.lines_sum_variance_pct,
        extraction_confidence: docLine.invoice.extraction_confidence,
      }}
      line={{
        description: docLine.description,
        supplier_sku: docLine.supplier_sku,
        quantity: docLine.quantity,
        unit: docLine.unit,
        unit_price: docLine.unit_price,
        total_amount: docLine.total_amount,
        package_size: docLine.package_size,
        package_unit: docLine.package_unit,
        count_per_package: docLine.count_per_package,
        price_per_base_unit: docLine.price_per_base_unit,
        expected_price_per_base_unit: docLine.expected_price_per_base_unit,
        price_variance_pct: docLine.price_variance_pct,
        matched_name: docLine.matched_raw_material?.name ?? null,
      }}
      onClose={() => setDocOpen(false)}
      className="h-full"
    />
  ) : null;

  const panelActive = docOpen && !!docPanel;

  return (
    <div className="space-y-5">
      <FakturaerHeaderBanner title="Behandlingskø" subtitle="Fakturalinjer som krever manuell vurdering" />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          {entities.length > 1 && (
            <Select value={legalEntityId} onValueChange={(v) => { setLegalEntityId(v); setSupplierId("all"); }}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle selskaper</SelectItem>
                {entities.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                disabled={legalEntityId === "all"}
                className="w-[260px] justify-between font-normal"
              >
                <span className="truncate">
                  {supplierId === "all"
                    ? "Alle leverandører"
                    : suppliers.find((s) => s.id === supplierId)?.name ?? "Leverandør"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Søk leverandør…" />
                <CommandList>
                  <CommandEmpty>Ingen treff</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="Alle leverandører"
                      onSelect={() => { setSupplierId("all"); setSupplierOpen(false); }}
                    >
                      <Check className={supplierId === "all" ? "mr-2 h-4 w-4 opacity-100" : "mr-2 h-4 w-4 opacity-0"} />
                      Alle leverandører
                    </CommandItem>
                    {suppliers.map((s) => (
                      <CommandItem
                        key={s.id}
                        value={`${s.name} ${s.org_number ?? ""}`}
                        onSelect={() => { setSupplierId(s.id); setSupplierOpen(false); }}
                      >
                        <Check className={supplierId === s.id ? "mr-2 h-4 w-4 opacity-100" : "mr-2 h-4 w-4 opacity-0"} />
                        <span className="truncate">{s.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <span className="text-sm text-ink-secondary">Totalt {lines.length}{totalCount > lines.length ? ` av ${totalCount}` : ""} linjer til behandling{hiddenCount > 0 ? ` · ${hiddenCount} skjult fra flaggede eller avstemte fakturaer` : ""}</span>
        </div>
      </Card>

      {panelActive && !isMobile ? (
        <ResizablePanelGroup
          direction="horizontal"
          className="items-stretch"
          onLayout={(sizes) => { if (sizes[1]) localStorage.setItem(LS_SIZE, String(Math.round(sizes[1]))); }}
        >
          <ResizablePanel defaultSize={100 - panelSize} minSize={35}>
            <div className="pr-3">{tabsEl}</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={panelSize} minSize={30} maxSize={65}>
            <div className="sticky top-4 h-[calc(100vh-8rem)] pl-3">{docPanel}</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        tabsEl
      )}

      {panelActive && isMobile && (
        <Sheet open onOpenChange={(v) => { if (!v) setDocOpen(false); }}>
          <SheetContent side="bottom" className="h-[95vh] p-0">
            {docPanel}
          </SheetContent>
        </Sheet>
      )}

      <BulkAcceptSuggestionsDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        candidates={bulkCandidates}
        thresholdPct={Number(bulkThreshold)}
      />

      <MatchDrawer open={matchOpen} onOpenChange={setMatchOpen} line={activeLine} />
      <CreateRawMaterialDialog open={createOpen} onOpenChange={setCreateOpen} line={activeLine} />
      <NotARawMaterialDialog open={notRmOpen} onOpenChange={setNotRmOpen} line={activeLine} />
      <SkuConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} line={activeLine} onOpenMatchDrawer={() => setMatchOpen(true)} />
    </div>
  );
}

function ReviewTable({ lines, reason, toleranceFor, onAction, onOpenInvoice, onShowDocument, docOpen, activeLineId }: {
  lines: ReviewLineRow[]; reason: ReviewReason;
  toleranceFor: (category?: string | null) => number;
  onAction: (a: "match" | "create" | "not_rm" | "conflict", l: ReviewLineRow) => void;
  onOpenInvoice: (id: string) => void;
  onShowDocument: (l: ReviewLineRow) => void;
  docOpen: boolean;
  activeLineId: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
          <tr>
            <th className="w-9 px-1 py-3"><span className="sr-only">Dokument</span></th>
            <th className="px-3 py-3">Faktura</th>
            <th className="px-3 py-3">Leverandør</th>
            <th className="px-3 py-3">SKU</th>
            <th className="px-3 py-3">Beskrivelse</th>
            <th className="px-3 py-3">Årsaker</th>
            <th className="px-3 py-3 text-right">Antall</th>
            <th className="px-3 py-3 text-right">Pris/enhet</th>
            <th className="px-3 py-3 text-right">Sum</th>
            {reason === "low_confidence" && <th className="px-3 py-3">Forslag</th>}
            {(reason === "price_variance" || reason === "price_increase") && <th className="px-3 py-3 text-right">Avvik</th>}
            {reason === "no_baseline" && <th className="px-3 py-3">Råvare</th>}
            {reason === "sku_collision" && <th className="px-3 py-3">Tidligere</th>}
            <th className="px-3 py-3 text-right">Handlinger</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const top = l.suggestions?.[0];
            const variance = l.price_variance_pct ?? 0;
            const category = l.matched_raw_material?.category ?? top?.raw_material?.category ?? null;
            const tol = toleranceFor(category);
            const absVar = Math.abs(variance);
            const varColor = absVar > tol * 2 ? "text-destructive" : absVar > tol ? "text-warning" : "text-ink-primary";
            const isActive = docOpen && activeLineId === l.id;
            return (
              <tr
                key={l.id}
                onClick={docOpen ? () => onShowDocument(l) : undefined}
                className={cn(
                  "border-t border-line-subtle",
                  docOpen && "cursor-pointer hover:bg-muted/30",
                  isActive && "border-l-2 border-l-primary bg-primary/5",
                )}
              >
                <td className="px-1 py-3">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={!l.invoice.source_document_url}
                          onClick={(e) => { e.stopPropagation(); onShowDocument(l); }}
                          aria-label="Vis faktura"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {l.invoice.source_document_url ? "Vis faktura" : "Originalfaktura ikke tilgjengelig"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </td>
                <td className="px-3 py-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenInvoice(l.invoice_id); }}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {l.invoice.invoice_number}
                  </button>
                  <div className="text-xs text-ink-secondary">{formatDate(l.invoice.invoice_date)}</div>
                </td>
                <td className="px-3 py-3">{l.invoice.supplier?.name}</td>
                <td className="px-3 py-3 font-mono text-xs">{l.supplier_sku ?? "—"}</td>
                <td className="px-3 py-3 max-w-[260px]">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="truncate">{l.description ?? "—"}</div>
                      </TooltipTrigger>
                      <TooltipContent><div className="max-w-sm">{l.description}</div></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {reasonsOf(l).length === 0 ? (
                      <span className="text-xs text-ink-secondary">—</span>
                    ) : (
                      reasonsOf(l).map((r) => (
                        <Badge key={r} variant="outline" className="text-[10px]">
                          {REASON_LABELS[r] ?? r}
                        </Badge>
                      ))
                    )}
                    {l.variance_status === "no_baseline" && l.raw_material_id && (
                      <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                        Uten avtalepris
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{l.quantity ?? "—"} {l.unit ?? ""}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatNok(l.unit_price)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatNok(l.total_amount)}</td>
                {reason === "low_confidence" && (
                  <td className="px-3 py-3">
                    {top ? (
                      <div>
                        <div className="flex items-center gap-1.5 font-medium">
                          {top.raw_material?.name ?? "—"}
                          <ItemTypeBadge itemType={top.raw_material?.item_type} />
                        </div>
                        <div className="text-xs text-ink-secondary">{Math.round((top.confidence ?? 0) * 100)}%</div>
                      </div>
                    ) : <span className="text-ink-secondary">—</span>}
                  </td>
                )}
                {reason === "no_baseline" && (
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      {l.matched_raw_material?.name ?? "—"}
                      <ItemTypeBadge itemType={l.matched_raw_material?.item_type} />
                    </span>
                  </td>
                )}
                {(reason === "price_variance" || reason === "price_increase") && (
                  <td className={`px-3 py-3 text-right tabular-nums font-medium ${varColor}`}>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>{variance > 0 ? "+" : ""}{variance.toFixed(1)}%</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Toleranse for {category ?? "uten kategori"}: {tol} %
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </td>
                )}
                {reason === "sku_collision" && (
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {top?.raw_material?.name ?? "—"}
                      <ItemTypeBadge itemType={top?.raw_material?.item_type} />
                    </div>
                  </td>
                )}
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1.5">
                    {reason === "sku_collision" ? (
                      <Button size="sm" onClick={() => onAction("conflict", l)}>Løs konflikt</Button>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => onAction("match", l)}>Match</Button>
                        <Button size="sm" variant="outline" onClick={() => onAction("create", l)}>Ny vare</Button>
                        <Button size="sm" variant="ghost" onClick={() => onAction("not_rm", l)}>Ikke råvare</Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
