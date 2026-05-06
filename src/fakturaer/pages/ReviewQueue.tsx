import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, AlertTriangle } from "lucide-react";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import { useReviewLines, type ReviewLineRow, type ReviewReason } from "@/fakturaer/hooks/useReviewLines";
import { useFakturaerLegalEntities } from "@/fakturaer/hooks/useFakturaerLegalEntities";
import { useSuppliersFor } from "@/fakturaer/hooks/useSuppliersFor";
import { formatNok, formatDate } from "@/fakturaer/lib/constants";
import { MatchDrawer } from "@/fakturaer/components/MatchDrawer";
import { CreateRawMaterialDialog } from "@/fakturaer/components/CreateRawMaterialDialog";
import { NotARawMaterialDialog } from "@/fakturaer/components/NotARawMaterialDialog";
import { SkuConflictDialog } from "@/fakturaer/components/SkuConflictDialog";

const TABS: { value: ReviewReason; label: string }[] = [
  { value: "unmatched", label: "Umatchet" },
  { value: "low_confidence", label: "Lav tillit" },
  { value: "price_variance", label: "Prisavvik" },
  { value: "sku_collision", label: "Konflikter" },
];

function reasonOf(line: ReviewLineRow): ReviewReason {
  const r = (line.review_reason ?? "").split(",")[0]?.trim() as ReviewReason;
  return (TABS.find((t) => t.value === r)?.value ?? "unmatched");
}

export default function FakturaerReviewQueuePage() {
  const navigate = useNavigate();
  const { data: entities = [] } = useFakturaerLegalEntities();
  const [legalEntityId, setLegalEntityId] = useState<string>("all");
  const [supplierId, setSupplierId] = useState<string>("all");
  const [tab, setTab] = useState<ReviewReason>("unmatched");

  const { data: suppliers = [] } = useSuppliersFor(legalEntityId === "all" ? null : legalEntityId);

  const { data: lines = [], isLoading } = useReviewLines({
    legalEntityId: legalEntityId === "all" ? null : legalEntityId,
    supplierId: supplierId === "all" ? null : supplierId,
  });

  const counts = useMemo(() => {
    const c: Record<ReviewReason, number> = { unmatched: 0, low_confidence: 0, price_variance: 0, sku_collision: 0 };
    lines.forEach((l) => { c[reasonOf(l)] = (c[reasonOf(l)] ?? 0) + 1; });
    return c;
  }, [lines]);

  const filteredLines = useMemo(() => lines.filter((l) => reasonOf(l) === tab), [lines, tab]);

  // Action dialogs
  const [activeLine, setActiveLine] = useState<ReviewLineRow | null>(null);
  const [matchOpen, setMatchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [notRmOpen, setNotRmOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);

  function open(action: "match" | "create" | "not_rm" | "conflict", line: ReviewLineRow) {
    setActiveLine(line);
    setMatchOpen(action === "match");
    setCreateOpen(action === "create");
    setNotRmOpen(action === "not_rm");
    setConflictOpen(action === "conflict");
  }

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
          <Select value={supplierId} onValueChange={setSupplierId} disabled={legalEntityId === "all"}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Leverandør" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle leverandører</SelectItem>
              {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-sm text-ink-secondary">Totalt {lines.length} linjer til behandling</span>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ReviewReason)}>
        <TabsList>
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
                <ReviewTable
                  lines={filteredLines}
                  reason={t.value}
                  onAction={open}
                  onOpenInvoice={(id) => navigate(`/fakturaer/${id}`)}
                />
              )}
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <MatchDrawer open={matchOpen} onOpenChange={setMatchOpen} line={activeLine} />
      <CreateRawMaterialDialog open={createOpen} onOpenChange={setCreateOpen} line={activeLine} />
      <NotARawMaterialDialog open={notRmOpen} onOpenChange={setNotRmOpen} line={activeLine} />
      <SkuConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} line={activeLine} onOpenMatchDrawer={() => setMatchOpen(true)} />
    </div>
  );
}

function ReviewTable({ lines, reason, onAction, onOpenInvoice }: {
  lines: ReviewLineRow[]; reason: ReviewReason;
  onAction: (a: "match" | "create" | "not_rm" | "conflict", l: ReviewLineRow) => void;
  onOpenInvoice: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
          <tr>
            <th className="px-3 py-3">Faktura</th>
            <th className="px-3 py-3">Leverandør</th>
            <th className="px-3 py-3">SKU</th>
            <th className="px-3 py-3">Beskrivelse</th>
            <th className="px-3 py-3 text-right">Antall</th>
            <th className="px-3 py-3 text-right">Pris/enhet</th>
            <th className="px-3 py-3 text-right">Sum</th>
            {reason === "low_confidence" && <th className="px-3 py-3">Forslag</th>}
            {reason === "price_variance" && <th className="px-3 py-3 text-right">Avvik</th>}
            {reason === "sku_collision" && <th className="px-3 py-3">Tidligere</th>}
            <th className="px-3 py-3 text-right">Handlinger</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const top = l.suggestions?.[0];
            const variance = l.price_variance_pct ?? 0;
            const tolMul = 2; // approx; we don't have real tol here
            const varColor = Math.abs(variance) > tolMul * 2 ? "text-destructive" : "text-warning";
            return (
              <tr key={l.id} className="border-t border-line-subtle">
                <td className="px-3 py-3">
                  <button onClick={() => onOpenInvoice(l.invoice_id)} className="font-mono text-xs text-primary hover:underline">
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
                <td className="px-3 py-3 text-right tabular-nums">{l.quantity ?? "—"} {l.unit ?? ""}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatNok(l.unit_price)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatNok(l.total_amount)}</td>
                {reason === "low_confidence" && (
                  <td className="px-3 py-3">
                    {top ? (
                      <div>
                        <div className="font-medium">{top.raw_material?.name ?? "—"}</div>
                        <div className="text-xs text-ink-secondary">{Math.round((top.confidence ?? 0) * 100)}%</div>
                      </div>
                    ) : <span className="text-ink-secondary">—</span>}
                  </td>
                )}
                {reason === "price_variance" && (
                  <td className={`px-3 py-3 text-right tabular-nums font-medium ${varColor}`}>
                    {variance > 0 ? "+" : ""}{variance.toFixed(1)}%
                  </td>
                )}
                {reason === "sku_collision" && (
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {top?.raw_material?.name ?? "—"}
                    </div>
                  </td>
                )}
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-1.5">
                    {reason === "sku_collision" ? (
                      <Button size="sm" onClick={() => onAction("conflict", l)}>Løs konflikt</Button>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => onAction("match", l)}>Match</Button>
                        <Button size="sm" variant="outline" onClick={() => onAction("create", l)}>Ny råvare</Button>
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
