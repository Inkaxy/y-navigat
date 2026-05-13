import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Upload,
  X,
  AlertTriangle,
  Check,
  Loader2,
  FileImage,
  Search,
  Plus,
  ImageOff,
  Image as ImageIcon,
  CloudUpload,
  CloudOff,
  CircleDashed,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ProductOption {
  id: string;
  display_name: string;
  display_number: number;
  code: string;
  image_url: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: ProductOption[];
  onComplete?: () => void;
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 200;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const UPLOAD_CONCURRENCY = 5;

type RowStatus = "auto" | "multi" | "none" | "rejected";
type UploadState = "pending" | "ok" | "error" | "skipped";

interface Row {
  key: string;
  file: File;
  previewUrl: string;
  status: RowStatus;
  rejectReason?: string;
  candidateIds: string[]; // matched options (multi/auto). Empty for "none".
  selectedProductIds: string[]; // confirmed targets (can be multiple)
  matchedBy?: "display_number" | "code" | "display_name";
  confirmed: boolean;
  skipped: boolean;
  // post-upload
  uploadState: UploadState;
  uploadError?: string;
  /** Antall produkter som faktisk fikk bildet (av selectedProductIds). */
  uploadedCount?: number;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function stripExt(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

interface MatchIndexes {
  byDisplayNumber: Map<string, ProductOption[]>;
  byCode: Map<string, ProductOption[]>;
  byDisplayName: Map<string, ProductOption[]>;
}

function buildIndexes(products: ProductOption[]): MatchIndexes {
  const byDisplayNumber = new Map<string, ProductOption[]>();
  const byCode = new Map<string, ProductOption[]>();
  const byDisplayName = new Map<string, ProductOption[]>();
  const push = (m: Map<string, ProductOption[]>, k: string, p: ProductOption) => {
    const arr = m.get(k);
    if (arr) arr.push(p);
    else m.set(k, [p]);
  };
  for (const p of products) {
    push(byDisplayNumber, String(p.display_number), p);
    push(byCode, normalize(p.code ?? ""), p);
    push(byDisplayName, normalize(p.display_name ?? ""), p);
  }
  return { byDisplayNumber, byCode, byDisplayName };
}

function matchFile(
  file: File,
  idx: MatchIndexes,
): { status: RowStatus; candidateIds: string[]; matchedBy?: Row["matchedBy"]; rejectReason?: string } {
  if (!ALLOWED.includes(file.type)) {
    return { status: "rejected", candidateIds: [], rejectReason: "Ikke støttet format" };
  }
  if (file.size > MAX_BYTES) {
    return { status: "rejected", candidateIds: [], rejectReason: "Større enn 5 MB" };
  }
  const base = normalize(stripExt(file.name));

  if (/^\d+$/.test(base)) {
    const hits = idx.byDisplayNumber.get(base);
    if (hits && hits.length > 0) {
      return hits.length === 1
        ? { status: "auto", candidateIds: [hits[0].id], matchedBy: "display_number" }
        : { status: "multi", candidateIds: hits.map((h) => h.id), matchedBy: "display_number" };
    }
  }
  const codeHits = idx.byCode.get(base);
  if (codeHits && codeHits.length > 0) {
    return codeHits.length === 1
      ? { status: "auto", candidateIds: [codeHits[0].id], matchedBy: "code" }
      : { status: "multi", candidateIds: codeHits.map((h) => h.id), matchedBy: "code" };
  }
  const nameHits = idx.byDisplayName.get(base);
  if (nameHits && nameHits.length > 0) {
    return nameHits.length === 1
      ? { status: "auto", candidateIds: [nameHits[0].id], matchedBy: "display_name" }
      : { status: "multi", candidateIds: nameHits.map((h) => h.id), matchedBy: "display_name" };
  }
  return { status: "none", candidateIds: [] };
}

export function BulkImageUploadDialog({ open, onOpenChange, products, onComplete }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<"select" | "uploading" | "done">("select");
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const productById = useMemo(() => {
    const m = new Map<string, ProductOption>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const indexes = useMemo(() => buildIndexes(products), [products]);

  useEffect(() => {
    return () => {
      rows.forEach((r) => URL.revokeObjectURL(r.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    rows.forEach((r) => URL.revokeObjectURL(r.previewUrl));
    setRows([]);
    setPhase("select");
    setProgress({ done: 0, total: 0 });
    if (inputRef.current) inputRef.current.value = "";
  }

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const remaining = MAX_FILES - rows.length;
    const usable = arr.slice(0, remaining);
    if (arr.length > remaining)
      toast.warning(`Maks ${MAX_FILES} filer per batch — ${arr.length - remaining} ble droppet`);

    const newRows: Row[] = usable.map((file) => {
      const m = matchFile(file, indexes);
      return {
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: m.status,
        rejectReason: m.rejectReason,
        candidateIds: m.candidateIds,
        selectedProductIds: m.status === "auto" ? [m.candidateIds[0]] : [],
        matchedBy: m.matchedBy,
        confirmed: false,
        skipped: m.status === "rejected",
        uploadState: "pending",
      };
    });
    setRows((prev) => [...prev, ...newRows]);
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setRows((prev) => {
      const r = prev.find((x) => x.key === key);
      if (r) URL.revokeObjectURL(r.previewUrl);
      return prev.filter((x) => x.key !== key);
    });
  }

  // ---- counters
  const counts = useMemo(() => {
    let confirmed = 0;
    let needsAction = 0;
    let skipped = 0;
    let rejected = 0;
    let replacing = 0;
    let totalTargets = 0;
    for (const r of rows) {
      if (r.status === "rejected") {
        rejected++;
        continue;
      }
      if (r.skipped) {
        skipped++;
        continue;
      }
      if (r.confirmed && r.selectedProductIds.length > 0) {
        confirmed++;
        totalTargets += r.selectedProductIds.length;
        for (const pid of r.selectedProductIds) {
          if (productById.get(pid)?.image_url) replacing++;
        }
      } else {
        needsAction++;
      }
    }
    return { confirmed, needsAction, skipped, rejected, replacing, totalTargets };
  }, [rows, productById]);

  const canImport = phase === "select" && counts.confirmed >= 1 && counts.needsAction === 0;

  // ---- bulk actions
  function bulkConfirmAutoMatch() {
    setRows((prev) =>
      prev.map((r) => {
        if (r.status !== "auto" || r.skipped || r.selectedProductIds.length === 0) return r;
        const anyExisting = r.selectedProductIds.some((pid) => productById.get(pid)?.image_url);
        if (anyExisting) return r;
        return { ...r, confirmed: true };
      }),
    );
  }
  function bulkConfirmReplacements() {
    setRows((prev) =>
      prev.map((r) => {
        if (r.skipped || r.selectedProductIds.length === 0) return r;
        const anyExisting = r.selectedProductIds.some((pid) => productById.get(pid)?.image_url);
        if (!anyExisting) return r;
        return { ...r, confirmed: true };
      }),
    );
  }
  function bulkSkipNoMatch() {
    setRows((prev) =>
      prev.map((r) =>
        r.status === "none" && r.selectedProductIds.length === 0
          ? { ...r, skipped: true, confirmed: false }
          : r,
      ),
    );
  }

  // ---- upload
  async function runImport() {
    const queue = rows.filter(
      (r) => r.confirmed && r.selectedProductIds.length > 0 && !r.skipped && r.status !== "rejected",
    );
    if (queue.length === 0) return;
    setPhase("uploading");
    setProgress({ done: 0, total: queue.length });

    let cursor = 0;
    const inFlight: Promise<void>[] = [];

    const runOne = async (row: Row) => {
      try {
        const ext = (row.file.name.split(".").pop() ?? "jpg").toLowerCase();
        // Last opp filen ÉN gang — alle produkter får samme URL.
        const path = `shared/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("product-images")
          .upload(path, row.file, { upsert: true, contentType: row.file.type });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
        const newUrl = pub.publicUrl;

        let okCount = 0;
        const errors: string[] = [];
        for (const pid of row.selectedProductIds) {
          const oldUrl = productById.get(pid)?.image_url ?? null;
          const { error: dbErr } = await supabase
            .from("products")
            .update({ image_url: newUrl })
            .eq("id", pid);
          if (dbErr) {
            errors.push(`${productById.get(pid)?.display_name ?? pid}: ${dbErr.message}`);
            continue;
          }
          okCount++;
          // Best-effort: slett gammelt bilde HVIS ingen andre produkter peker på det
          if (oldUrl && oldUrl !== newUrl) {
            const m = oldUrl.match(/\/product-images\/(.+)$/);
            if (m?.[1]) {
              try {
                const { count } = await supabase
                  .from("products")
                  .select("id", { count: "exact", head: true })
                  .eq("image_url", oldUrl);
                if ((count ?? 0) === 0) {
                  await supabase.storage.from("product-images").remove([m[1]]);
                }
              } catch (e) {
                console.warn("Kunne ikke vurdere/slette gammelt bilde", oldUrl, e);
              }
            }
          }
        }
        if (errors.length > 0 && okCount === 0) {
          throw new Error(errors.join(" · "));
        }
        updateRow(row.key, {
          uploadState: "ok",
          uploadedCount: okCount,
          uploadError: errors.length > 0 ? errors.join(" · ") : undefined,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Ukjent feil";
        updateRow(row.key, { uploadState: "error", uploadError: msg });
      } finally {
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };

    while (cursor < queue.length || inFlight.length > 0) {
      while (inFlight.length < UPLOAD_CONCURRENCY && cursor < queue.length) {
        const row = queue[cursor++];
        const p = runOne(row).finally(() => {
          const idx = inFlight.indexOf(p);
          if (idx >= 0) inFlight.splice(idx, 1);
        });
        inFlight.push(p);
      }
      if (inFlight.length > 0) await Promise.race(inFlight);
    }

    setPhase("done");
  }

  function closeAndRefresh() {
    onComplete?.();
    qc.invalidateQueries({ queryKey: ["products"] });
    onOpenChange(false);
    setTimeout(reset, 200);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v && phase === "uploading") return;
        if (!v) {
          if (phase === "done") closeAndRefresh();
          else {
            onOpenChange(false);
            setTimeout(reset, 200);
          }
        } else {
          onOpenChange(true);
        }
      }}
    >
      <SheetContent
        side="right"
        className="w-full max-w-[min(96vw,1240px)] sm:max-w-[min(96vw,1240px)] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Massimport produktbilder</SheetTitle>
          <SheetDescription>
            Last opp mange bildefiler — vi matcher mot produkter på filnavn (varenummer, kode eller navn).
            Du kan knytte samme bilde til flere produkter. Bekreft hver rad før import.
          </SheetDescription>
        </SheetHeader>

        {phase === "select" && (
          <div className="mt-5 space-y-5">
            {/* Drop zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className="cursor-pointer rounded-lg border-2 border-dashed border-border bg-muted/20 p-8 text-center hover:bg-muted/40"
            >
              <FileImage className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
              <div className="text-sm font-medium">Dra bildefiler hit, eller klikk for å velge</div>
              <div className="mt-1 text-xs text-muted-foreground">
                JPG/PNG/WEBP • maks 5 MB per fil • maks {MAX_FILES} filer per batch
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {rows.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={bulkConfirmAutoMatch}>
                    Bekreft alle auto-match
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={bulkConfirmReplacements}
                    className="border-warning/40 text-warning hover:text-warning"
                  >
                    Bekreft alle som erstatter eksisterende
                  </Button>
                  <Button size="sm" variant="outline" onClick={bulkSkipNoMatch}>
                    Hopp over alle uten match
                  </Button>
                  <Button size="sm" variant="ghost" onClick={reset} className="ml-auto">
                    Tøm liste
                  </Button>
                </div>

                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 w-16">Bilde</th>
                        <th className="px-3 py-2">Filnavn / status</th>
                        <th className="px-3 py-2">Knyttet til produkt(er)</th>
                        <th className="px-3 py-2 w-32">Bilde-status</th>
                        <th className="px-3 py-2 w-20 text-center">Bekreft</th>
                        <th className="px-3 py-2 w-20 text-center">Hopp over</th>
                        <th className="px-3 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <BulkRow
                          key={r.key}
                          row={r}
                          products={products}
                          productById={productById}
                          onUpdate={(patch) => updateRow(r.key, patch)}
                          onRemove={() => removeRow(r.key)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {rows.length > 0 && (
              <div className="sticky bottom-0 -mx-6 border-t border-border bg-background/95 px-6 py-4 backdrop-blur">
                <div className="mb-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <Badge variant="outline" className="border-success/40 text-success">
                    {counts.confirmed} bekreftet ({counts.totalTargets} produktkoblinger)
                  </Badge>
                  <Badge
                    variant="outline"
                    className={counts.needsAction > 0 ? "border-warning/40 text-warning" : ""}
                  >
                    {counts.needsAction} trenger handling
                  </Badge>
                  <Badge variant="outline">{counts.skipped} hoppes over</Badge>
                  {counts.rejected > 0 && (
                    <Badge variant="outline" className="border-destructive/40 text-destructive">
                      {counts.rejected} avvist
                    </Badge>
                  )}
                </div>
                {counts.replacing > 0 && (
                  <div className="mb-2 flex items-center gap-1.5 text-xs text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {counts.replacing} produkter får erstattet eksisterende bilde
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      onOpenChange(false);
                      setTimeout(reset, 200);
                    }}
                  >
                    Avbryt
                  </Button>
                  <Button onClick={runImport} disabled={!canImport}>
                    <Upload className="mr-1.5 h-4 w-4" />
                    Last opp {counts.confirmed} bilder ({counts.totalTargets} produkter)
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {phase === "uploading" && (
          <div className="mt-10 space-y-4 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <div className="text-sm font-medium">
              Laster opp {progress.done} av {progress.total}…
            </div>
            <Progress
              value={progress.total ? (progress.done / progress.total) * 100 : 0}
              className="mx-auto max-w-md"
            />
            <div className="text-xs text-muted-foreground">Ikke lukk vinduet før importen er ferdig.</div>
          </div>
        )}

        {phase === "done" && <DoneReport rows={rows} productById={productById} onClose={closeAndRefresh} />}
      </SheetContent>
    </Sheet>
  );
}

// ============== Row ==============
function BulkRow({
  row,
  products,
  productById,
  onUpdate,
  onRemove,
}: {
  row: Row;
  products: ProductOption[];
  productById: Map<string, ProductOption>;
  onUpdate: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const selectedProducts = row.selectedProductIds
    .map((id) => productById.get(id))
    .filter((p): p is ProductOption => !!p);

  const candidateProducts = row.candidateIds
    .map((id) => productById.get(id))
    .filter((p): p is ProductOption => !!p);

  const canConfirm =
    row.selectedProductIds.length > 0 && row.status !== "rejected" && !row.skipped;

  const replacingCount = selectedProducts.filter((p) => !!p.image_url).length;
  const newCount = selectedProducts.length - replacingCount;

  function toggleProduct(id: string) {
    const set = new Set(row.selectedProductIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onUpdate({ selectedProductIds: Array.from(set), confirmed: false });
  }

  return (
    <tr className={cn("border-t border-border align-top", row.skipped && "opacity-50")}>
      <td className="px-3 py-2">
        <img
          src={row.previewUrl}
          alt={row.file.name}
          className="h-12 w-12 rounded border border-border object-cover"
        />
      </td>
      <td className="px-3 py-2">
        <div className="font-medium text-foreground">{row.file.name}</div>
        <div className="mt-1">
          <StatusBadge row={row} />
        </div>
        {row.matchedBy && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            via {row.matchedBy.replace("_", " ")}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {row.status === "rejected" ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="space-y-1.5">
            {selectedProducts.length > 0 ? (
              <ul className="space-y-1">
                {selectedProducts.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1"
                  >
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt=""
                        className="h-7 w-7 shrink-0 rounded border border-warning/40 object-cover"
                        title="Erstatter eksisterende bilde"
                      />
                    ) : (
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-dashed border-border text-muted-foreground"
                        title="Ingen bilde fra før"
                      >
                        <ImageOff className="h-3.5 w-3.5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.display_name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        #{p.display_number} · {p.code}
                        {p.image_url && (
                          <span className="ml-1 text-warning">· erstatter bilde</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleProduct(p.id)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Fjern produkt"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-muted-foreground">Ingen produkt valgt</div>
            )}
            <ProductMultiPicker
              products={products}
              candidates={candidateProducts}
              selectedIds={row.selectedProductIds}
              onToggle={toggleProduct}
            />
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <ImageStatusCell selectedProducts={selectedProducts} replacingCount={replacingCount} newCount={newCount} />
      </td>
      <td className="px-3 py-2 text-center">
        <Checkbox
          checked={row.confirmed}
          disabled={!canConfirm}
          onCheckedChange={(c) => onUpdate({ confirmed: !!c })}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <Switch
          checked={row.skipped}
          disabled={row.status === "rejected"}
          onCheckedChange={(c) => onUpdate({ skipped: c, confirmed: c ? false : row.confirmed })}
        />
      </td>
      <td className="px-3 py-2">
        <Button variant="ghost" size="icon" onClick={onRemove} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}

function ImageStatusCell({
  selectedProducts,
  replacingCount,
  newCount,
}: {
  selectedProducts: ProductOption[];
  replacingCount: number;
  newCount: number;
}) {
  if (selectedProducts.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-1 text-xs">
      {newCount > 0 && (
        <div className="flex items-center gap-1.5 text-success">
          <ImageOff className="h-3.5 w-3.5" />
          {newCount} mangler bilde
        </div>
      )}
      {replacingCount > 0 && (
        <div className="flex items-center gap-1.5 text-warning">
          <ImageIcon className="h-3.5 w-3.5" />
          {replacingCount} har bilde · erstattes
        </div>
      )}
    </div>
  );
}

function StatusBadge({ row }: { row: Row }) {
  if (row.status === "rejected") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        Avvist · {row.rejectReason}
      </Badge>
    );
  }
  if (row.status === "auto") {
    return (
      <Badge variant="outline" className="border-success/40 text-success">
        Auto-match
      </Badge>
    );
  }
  if (row.status === "multi") {
    return (
      <Badge variant="outline" className="border-warning/40 text-warning">
        Flere match — velg
      </Badge>
    );
  }
  return <Badge variant="outline">Ingen match — velg</Badge>;
}

// ============== Multi-product picker ==============
function ProductMultiPicker({
  products,
  candidates,
  selectedIds,
  onToggle,
}: {
  products: ProductOption[];
  candidates: ProductOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(candidates.length === 0);
  const list = showAll || candidates.length === 0 ? products : candidates;
  const selectedSet = new Set(selectedIds);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Legg til produkt
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <Command>
          <div className="flex items-center gap-2 border-b border-border px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <CommandInput placeholder="Søk på navn, nummer, kode…" className="h-9 border-0 px-0" />
          </div>
          {candidates.length > 0 && (
            <div className="flex items-center justify-between border-b border-border bg-muted/20 px-3 py-1.5 text-[11px]">
              <span className="text-muted-foreground">
                {showAll ? "Viser alle produkter" : `${candidates.length} treff fra filnavn`}
              </span>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-app underline-offset-2 hover:underline"
              >
                {showAll ? "Vis kun treff" : "Vis alle produkter"}
              </button>
            </div>
          )}
          <CommandList>
            <CommandEmpty>Ingen treff</CommandEmpty>
            <CommandGroup>
              {list.map((p) => {
                const isSelected = selectedSet.has(p.id);
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.display_name} ${p.display_number} ${p.code}`}
                    onSelect={() => onToggle(p.id)}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{p.display_name}</div>
                      <div className="text-xs text-muted-foreground">
                        #{p.display_number} · {p.code}
                        {p.image_url && <span className="ml-1 text-warning">· har bilde</span>}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          <div className="flex justify-end border-t border-border px-2 py-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>
              Ferdig
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ============== Done report ==============
function DoneReport({
  rows,
  productById,
  onClose,
}: {
  rows: Row[];
  productById: Map<string, ProductOption>;
  onClose: () => void;
}) {
  const processed = rows.filter(
    (r) => r.confirmed && !r.skipped && r.status !== "rejected" && r.selectedProductIds.length > 0,
  );
  const ok = processed.filter((r) => r.uploadState === "ok");
  const failed = processed.filter((r) => r.uploadState === "error");
  const notUploaded = rows.filter(
    (r) => r.skipped || r.status === "rejected" || (!r.confirmed && r.uploadState === "pending"),
  );
  const totalProducts = ok.reduce((acc, r) => acc + (r.uploadedCount ?? r.selectedProductIds.length), 0);

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="border-success/40 text-success">
          <CloudUpload className="mr-1 h-3.5 w-3.5" />
          {ok.length} bilder lastet opp ({totalProducts} produkter)
        </Badge>
        {failed.length > 0 && (
          <Badge variant="outline" className="border-destructive/40 text-destructive">
            <CloudOff className="mr-1 h-3.5 w-3.5" />
            {failed.length} feilet
          </Badge>
        )}
        <Badge variant="outline">
          <CircleDashed className="mr-1 h-3.5 w-3.5" />
          {notUploaded.length} ikke lastet opp
        </Badge>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 w-16">Bilde</th>
              <th className="px-3 py-2">Filnavn</th>
              <th className="px-3 py-2">Knyttet til</th>
              <th className="px-3 py-2 w-40">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const targets = r.selectedProductIds
                .map((id) => productById.get(id))
                .filter((p): p is ProductOption => !!p);
              return (
                <tr key={r.key} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <img
                      src={r.previewUrl}
                      alt={r.file.name}
                      className="h-10 w-10 rounded border border-border object-cover"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.file.name}</div>
                    {r.uploadError && (
                      <div className="mt-1 text-[11px] text-destructive">{r.uploadError}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {targets.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {targets.map((p) => (
                          <Badge key={p.id} variant="outline" className="text-[11px]">
                            {p.display_name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <UploadStateBadge row={r} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button onClick={onClose}>Lukk og oppdater liste</Button>
      </div>
    </div>
  );
}

function UploadStateBadge({ row }: { row: Row }) {
  if (row.status === "rejected") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        Avvist
      </Badge>
    );
  }
  if (row.skipped) {
    return <Badge variant="outline">Hoppet over</Badge>;
  }
  if (!row.confirmed) {
    return <Badge variant="outline">Ikke bekreftet</Badge>;
  }
  if (row.uploadState === "ok") {
    return (
      <Badge variant="outline" className="border-success/40 text-success">
        <Check className="mr-1 h-3.5 w-3.5" />
        Lastet opp ({row.uploadedCount}/{row.selectedProductIds.length})
      </Badge>
    );
  }
  if (row.uploadState === "error") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        <CloudOff className="mr-1 h-3.5 w-3.5" />
        Feilet
      </Badge>
    );
  }
  return <Badge variant="outline">Avventer</Badge>;
}
