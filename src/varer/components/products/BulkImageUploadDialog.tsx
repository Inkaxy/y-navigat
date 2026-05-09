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
import { Upload, X, AlertTriangle, Check, Loader2, FileImage, Search } from "lucide-react";
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

interface Row {
  key: string;
  file: File;
  previewUrl: string;
  status: RowStatus;
  rejectReason?: string;
  candidateIds: string[]; // for multi/none — all options that matched (multi) or empty (none)
  selectedProductId: string | null;
  matchedBy?: "display_number" | "code" | "display_name";
  confirmed: boolean;
  skipped: boolean;
  // post-upload
  uploadResult?: "ok" | "error" | "skipped";
  uploadError?: string;
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

function matchFile(file: File, idx: MatchIndexes): { status: RowStatus; candidateIds: string[]; matchedBy?: Row["matchedBy"]; rejectReason?: string } {
  if (!ALLOWED.includes(file.type)) {
    return { status: "rejected", candidateIds: [], rejectReason: "Ikke støttet format" };
  }
  if (file.size > MAX_BYTES) {
    return { status: "rejected", candidateIds: [], rejectReason: "Større enn 5 MB" };
  }
  const base = normalize(stripExt(file.name));

  // 1. display_number — pure numeric
  if (/^\d+$/.test(base)) {
    const hits = idx.byDisplayNumber.get(base);
    if (hits && hits.length > 0) {
      return hits.length === 1
        ? { status: "auto", candidateIds: [hits[0].id], matchedBy: "display_number" }
        : { status: "multi", candidateIds: hits.map((h) => h.id), matchedBy: "display_number" };
    }
  }
  // 2. code
  const codeHits = idx.byCode.get(base);
  if (codeHits && codeHits.length > 0) {
    return codeHits.length === 1
      ? { status: "auto", candidateIds: [codeHits[0].id], matchedBy: "code" }
      : { status: "multi", candidateIds: codeHits.map((h) => h.id), matchedBy: "code" };
  }
  // 3. display_name
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

  // Cleanup object URLs
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
    if (arr.length > remaining) toast.warning(`Maks ${MAX_FILES} filer per batch — ${arr.length - remaining} ble droppet`);

    const newRows: Row[] = usable.map((file) => {
      const m = matchFile(file, indexes);
      return {
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: m.status,
        rejectReason: m.rejectReason,
        candidateIds: m.candidateIds,
        selectedProductId: m.status === "auto" ? m.candidateIds[0] : null,
        matchedBy: m.matchedBy,
        confirmed: false,
        skipped: m.status === "rejected",
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
    for (const r of rows) {
      if (r.status === "rejected") {
        rejected++;
        continue;
      }
      if (r.skipped) {
        skipped++;
        continue;
      }
      if (r.confirmed && r.selectedProductId) {
        confirmed++;
        if (productById.get(r.selectedProductId)?.image_url) replacing++;
      } else {
        needsAction++;
      }
    }
    return { confirmed, needsAction, skipped, rejected, replacing };
  }, [rows, productById]);

  const canImport = phase === "select" && counts.confirmed >= 1 && counts.needsAction === 0;

  // ---- bulk actions
  function bulkConfirmAutoMatch() {
    setRows((prev) =>
      prev.map((r) => {
        if (r.status !== "auto" || r.skipped || !r.selectedProductId) return r;
        // skip rows that would replace existing
        if (productById.get(r.selectedProductId)?.image_url) return r;
        return { ...r, confirmed: true };
      }),
    );
  }
  function bulkConfirmReplacements() {
    setRows((prev) =>
      prev.map((r) => {
        if (r.skipped || !r.selectedProductId) return r;
        if (!productById.get(r.selectedProductId)?.image_url) return r;
        return { ...r, confirmed: true };
      }),
    );
  }
  function bulkSkipNoMatch() {
    setRows((prev) =>
      prev.map((r) => (r.status === "none" && !r.selectedProductId ? { ...r, skipped: true, confirmed: false } : r)),
    );
  }

  // ---- upload
  async function runImport() {
    const queue = rows.filter((r) => r.confirmed && r.selectedProductId && !r.skipped && r.status !== "rejected");
    if (queue.length === 0) return;
    setPhase("uploading");
    setProgress({ done: 0, total: queue.length });

    // Snapshot of old image_urls to delete after success
    let cursor = 0;
    const inFlight: Promise<void>[] = [];

    const runOne = async (row: Row) => {
      try {
        const ext = (row.file.name.split(".").pop() ?? "jpg").toLowerCase();
        const path = `${row.selectedProductId}/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("product-images")
          .upload(path, row.file, { upsert: true, contentType: row.file.type });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
        const newUrl = pub.publicUrl;

        const oldUrl = productById.get(row.selectedProductId!)?.image_url ?? null;

        const { error: dbErr } = await supabase
          .from("products")
          .update({ image_url: newUrl })
          .eq("id", row.selectedProductId!);
        if (dbErr) throw dbErr;

        // Best-effort delete of old object in same bucket
        if (oldUrl) {
          const m = oldUrl.match(/\/product-images\/(.+)$/);
          if (m?.[1]) {
            try {
              await supabase.storage.from("product-images").remove([m[1]]);
            } catch (e) {
              console.warn("Kunne ikke slette gammelt bilde", oldUrl, e);
            }
          }
        }
        updateRow(row.key, { uploadResult: "ok" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Ukjent feil";
        updateRow(row.key, { uploadResult: "error", uploadError: msg });
      } finally {
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };

    // simple concurrency pump
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
    // Defer reset slightly so the closing animation doesn't show empty state flash
    setTimeout(reset, 200);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v && phase === "uploading") return; // block close while uploading
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
      <SheetContent side="right" className="w-full max-w-[min(96vw,1200px)] sm:max-w-[min(96vw,1200px)] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Massimport produktbilder</SheetTitle>
          <SheetDescription>
            Last opp mange bildefiler — vi matcher mot produkter på filnavn (varenummer, kode eller navn). Du må bekrefte hver rad før import.
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
                {/* Bulk actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={bulkConfirmAutoMatch}>
                    Bekreft alle auto-match
                  </Button>
                  <Button size="sm" variant="outline" onClick={bulkConfirmReplacements} className="border-warning/40 text-warning hover:text-warning">
                    Bekreft alle som erstatter eksisterende
                  </Button>
                  <Button size="sm" variant="outline" onClick={bulkSkipNoMatch}>
                    Hopp over alle uten match
                  </Button>
                  <Button size="sm" variant="ghost" onClick={reset} className="ml-auto">
                    Tøm liste
                  </Button>
                </div>

                {/* Table */}
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 w-16">Nytt</th>
                        <th className="px-3 py-2">Filnavn / status</th>
                        <th className="px-3 py-2">Matchet produkt</th>
                        <th className="px-3 py-2 w-24">Eksisterende</th>
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

            {/* Footer */}
            {rows.length > 0 && (
              <div className="sticky bottom-0 -mx-6 border-t border-border bg-background/95 px-6 py-4 backdrop-blur">
                <div className="mb-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <Badge variant="outline" className="border-success/40 text-success">{counts.confirmed} bekreftet</Badge>
                  <Badge variant="outline" className={counts.needsAction > 0 ? "border-warning/40 text-warning" : ""}>
                    {counts.needsAction} trenger handling
                  </Badge>
                  <Badge variant="outline">{counts.skipped} hoppes over</Badge>
                  {counts.rejected > 0 && (
                    <Badge variant="outline" className="border-destructive/40 text-destructive">{counts.rejected} avvist</Badge>
                  )}
                </div>
                {counts.replacing > 0 && (
                  <div className="mb-2 flex items-center gap-1.5 text-xs text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {counts.replacing} av {counts.confirmed} erstatter eksisterende bilder
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { onOpenChange(false); setTimeout(reset, 200); }}>
                    Avbryt
                  </Button>
                  <Button onClick={runImport} disabled={!canImport}>
                    <Upload className="mr-1.5 h-4 w-4" />
                    {counts.replacing > 0
                      ? `Importer og erstatt ${counts.confirmed} bilder`
                      : `Importer ${counts.confirmed} bilder`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {phase === "uploading" && (
          <div className="mt-10 space-y-4 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <div className="text-sm font-medium">Laster opp {progress.done} av {progress.total}…</div>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} className="mx-auto max-w-md" />
            <div className="text-xs text-muted-foreground">Ikke lukk vinduet før importen er ferdig.</div>
          </div>
        )}

        {phase === "done" && (
          <DoneReport rows={rows} onClose={closeAndRefresh} />
        )}
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
  const selected = row.selectedProductId ? productById.get(row.selectedProductId) : null;
  const replacing = !!selected?.image_url;

  const candidateProducts = row.candidateIds
    .map((id) => productById.get(id))
    .filter((p): p is ProductOption => !!p);

  const canConfirm = !!row.selectedProductId && row.status !== "rejected" && !row.skipped;

  return (
    <tr className={cn("border-t border-border align-top", row.skipped && "opacity-50")}>
      <td className="px-3 py-2">
        <img src={row.previewUrl} alt={row.file.name} className="h-12 w-12 rounded border border-border object-cover" />
      </td>
      <td className="px-3 py-2">
        <div className="font-medium text-foreground">{row.file.name}</div>
        <div className="mt-1">
          <StatusBadge row={row} />
        </div>
        {row.matchedBy && (
          <div className="mt-1 text-[11px] text-muted-foreground">via {row.matchedBy.replace("_", " ")}</div>
        )}
      </td>
      <td className="px-3 py-2">
        {row.status === "rejected" ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : row.status === "auto" && candidateProducts.length === 1 ? (
          <div className="text-sm">
            <div className="font-medium">{candidateProducts[0].display_name}</div>
            <div className="text-xs text-muted-foreground">#{candidateProducts[0].display_number} · {candidateProducts[0].code}</div>
            <button
              type="button"
              onClick={() => onUpdate({ selectedProductId: null, status: "none", candidateIds: [], confirmed: false })}
              className="mt-1 text-[11px] text-app underline-offset-2 hover:underline"
            >
              Endre
            </button>
          </div>
        ) : (
          <ProductPicker
            products={candidateProducts.length > 0 ? candidateProducts : products}
            value={row.selectedProductId}
            onChange={(id) => onUpdate({ selectedProductId: id, confirmed: false })}
            restrictedHint={candidateProducts.length > 0 ? "Velg blant treffene" : "Søk og velg manuelt"}
          />
        )}
      </td>
      <td className="px-3 py-2">
        {selected?.image_url ? (
          <img src={selected.image_url} alt="" className="h-12 w-12 rounded border border-warning/40 object-cover" />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
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

function StatusBadge({ row }: { row: Row }) {
  if (row.status === "rejected") {
    return <Badge variant="outline" className="border-destructive/40 text-destructive">Avvist · {row.rejectReason}</Badge>;
  }
  if (row.status === "auto") {
    const replacing = row.selectedProductId && row.candidateIds.length === 1;
    // Replacement label handled in product cell
    return <Badge variant="outline" className="border-success/40 text-success">Auto-match</Badge>;
  }
  if (row.status === "multi") {
    return <Badge variant="outline" className="border-warning/40 text-warning">Flere match — velg</Badge>;
  }
  return <Badge variant="outline">Ingen match — velg</Badge>;
}

// ============== Product picker ==============
function ProductPicker({
  products,
  value,
  onChange,
  restrictedHint,
}: {
  products: ProductOption[];
  value: string | null;
  onChange: (id: string) => void;
  restrictedHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? products.find((p) => p.id === value) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start font-normal">
          <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {selected ? (
            <span className="truncate">
              <span className="font-medium">{selected.display_name}</span>
              <span className="ml-2 text-xs text-muted-foreground">#{selected.display_number}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{restrictedHint ?? "Velg produkt…"}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Søk på navn, nummer, kode…" />
          <CommandList>
            <CommandEmpty>Ingen treff</CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.display_name} ${p.display_number} ${p.code}`}
                  onSelect={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                  <div className="flex-1">
                    <div className="font-medium">{p.display_name}</div>
                    <div className="text-xs text-muted-foreground">#{p.display_number} · {p.code}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ============== Done report ==============
function DoneReport({ rows, onClose }: { rows: Row[]; onClose: () => void }) {
  const ok = rows.filter((r) => r.uploadResult === "ok");
  const failed = rows.filter((r) => r.uploadResult === "error");
  const skipped = rows.filter((r) => r.skipped || r.status === "rejected" || (!r.confirmed && r.uploadResult === undefined));
  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="border-success/40 text-success">{ok.length} vellykket</Badge>
        <Badge variant="outline" className={failed.length > 0 ? "border-destructive/40 text-destructive" : ""}>
          {failed.length} feilet
        </Badge>
        <Badge variant="outline">{skipped.length} hoppet over</Badge>
      </div>
      {failed.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="mb-2 text-sm font-medium text-destructive">Feilede filer</div>
          <ul className="space-y-1 text-xs text-foreground">
            {failed.map((r) => (
              <li key={r.key}>
                <span className="font-mono">{r.file.name}</span> — {r.uploadError}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={onClose}>Lukk og oppdater liste</Button>
      </div>
    </div>
  );
}
