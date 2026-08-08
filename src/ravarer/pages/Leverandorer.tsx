import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Loader2, Truck, Plus, RefreshCw, Info } from "lucide-react";
import { toast } from "sonner";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import {
  useSuppliers,
  useSetTrackInvoiceLines,
  useSyncSuppliersFromTripletex,
  useBackfillSupplierInvoices,
  type SupplierRow,
} from "@/ravarer/hooks/useSuppliers";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { NewSupplierDialog } from "@/ravarer/components/NewSupplierDialog";

const TRACK_HELP =
  "Er denne på, hentes leverandørens fakturaer inn i NBhub: PDF-en lastes ned og varelinjene leses ut automatisk, slik at priser per råvare oppdateres. Er den av, hentes ingen fakturaer fra leverandøren i det hele tatt — leverandøren blir stående i listen, men uten fakturaer. Slå den på for råvareleverandører, og la den være av for strøm, forsikring og lignende.";

type ViewFilter = "alle" | "folges" | "aktive";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export default function LeverandorerPage() {
  const { canWrite } = useRavarer();
  const { data: rows = [], isLoading } = useSuppliers();
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [view, setView] = useState<ViewFilter>("alle");
  const [showInactive, setShowInactive] = useState(false);

  const setTracking = useSetTrackInvoiceLines();
  const sync = useSyncSuppliersFromTripletex();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showInactive && r.tripletex_is_inactive) return false;
      if (view === "folges" && !r.track_invoice_lines) return false;
      if (view === "aktive" && !r.is_active) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.org_number ?? "").toLowerCase().includes(q) ||
        (r.contact_email ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, view, showInactive]);

  const trackedCount = rows.filter((r) => r.track_invoice_lines).length;

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner
        title="Leverandører"
        subtitle="Alle aktive leverandører for valgt selskap"
        actions={
          canWrite && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
                className="gap-1.5"
              >
                {sync.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Hent fra Tripletex
              </Button>
              <Button size="sm" onClick={() => setNewOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" /> Ny leverandør
              </Button>
            </div>
          )
        }
      />
      <NewSupplierDialog open={newOpen} onOpenChange={setNewOpen} />

      <Card className="p-4 space-y-3">
        <p className="text-sm text-ink-secondary">
          <strong className="text-foreground">{trackedCount}</strong> av {rows.length} leverandører
          følges med varelinjer
        </p>
        <p className="text-xs text-ink-secondary max-w-3xl">{TRACK_HELP}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk navn, org.nr eller e-post…"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-1">
            {([
              ["alle", "Alle"],
              ["folges", "Kun følges"],
              ["aktive", "Kun aktive"],
            ] as [ViewFilter, string][]).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={view === key ? "default" : "outline"}
                onClick={() => setView(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Vis inaktive fra Tripletex
          </label>
          <span className="text-sm text-ink-secondary">{filtered.length} leverandører</span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-ink-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Truck className="mb-3 h-10 w-10 text-ink-secondary" />
            <p className="text-ink-secondary">Ingen leverandører funnet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <TooltipProvider delayDuration={200}>
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                  <tr>
                    <th className="px-4 py-3">Navn</th>
                    <th className="px-4 py-3">Org.nr</th>
                    <th className="px-4 py-3">E-post</th>
                    <th className="px-4 py-3">Telefon</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">
                      <span className="inline-flex items-center gap-1">
                        Følg fakturalinjer
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm text-xs normal-case">
                            {TRACK_HELP}
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </th>
                    <th className="px-4 py-3">Siste faktura</th>
                    <th className="px-4 py-3">Antall</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t border-line-subtle hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-secondary">
                        {r.org_number ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{r.contact_email ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-secondary">{r.contact_phone ?? "—"}</td>
                      <td className="px-4 py-3">
                        {r.tripletex_is_inactive ? (
                          <Badge variant="outline" className="text-ink-secondary">
                            Inaktiv i Tripletex
                          </Badge>
                        ) : r.is_active ? (
                          <Badge
                            variant="outline"
                            className="border-success/30 bg-success/10 text-success"
                          >
                            Aktiv
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-ink-secondary">
                            Inaktiv
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={!!r.track_invoice_lines}
                          disabled={!canWrite || setTracking.isPending}
                          onCheckedChange={(value) => setTracking.mutate({ id: r.id, value })}
                          aria-label={`Følg fakturalinjer for ${r.name}`}
                        />
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">
                        {formatDate(r.last_invoice_date)}
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{r.invoice_count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TooltipProvider>
          </div>
        )}
      </Card>
    </div>
  );
}
