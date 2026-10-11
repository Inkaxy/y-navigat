import { useMemo, useState } from "react";
import { AlertCircle, Check, FileText, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { rankBySearch } from "@/lib/textSimilarity";
import { BULK_FIELDS, FIELD_LABEL, type ExtractSummary, type MatchCandidate } from "@/ravarer/lib/datasheetBulk";

export interface BulkRow {
  key: string;
  file: File;
  status: "pending" | "uploading" | "extracting" | "matching" | "ready" | "error";
  stage?: "upload" | "extract" | "match";
  storage_path?: string;
  datasheet_id?: string;
  summary?: ExtractSummary;
  candidates: MatchCandidate[];
  /** Valgt mål i UI. Lagres ikke før brukeren anvender. */
  selectedRm: string | null;
  /** Valgt manuelt eller annen enn toppkandidat → aldri med i «Bekreft alle». */
  manualTarget: boolean;
  error?: string;
  applyState: "idle" | "applying" | "applied" | "failed";
  applyError?: string;
  followUps: string[];
  packageSuggestion: { size: number | null; unit: string | null } | null;
}

export interface MaterialOption { id: string; name: string; sku: string | null }

interface Props {
  row: BulkRow;
  canWrite: boolean;
  /** En anvendelse pågår (enkelt eller samlet): mål og handlinger er låst. */
  locked: boolean;
  materials: readonly MaterialOption[];
  onSelect: (rmId: string, manual: boolean) => void;
  onApply: () => void;
  onRetry: () => void;
  onCreate: () => void;
  onOpenPackage: () => void;
}

const pct = (s: number) => `${Math.round(s * 100)} %`;

export function BulkFileRow({ row: r, canWrite, locked, materials, onSelect, onApply, onRetry, onCreate, onOpenPackage }: Props) {
  const [q, setQ] = useState("");
  const results = useMemo(() => (q.trim().length < 2 ? [] : rankBySearch(materials, q.trim(), (m) => [m.name, m.sku ?? ""]).slice(0, 6)), [materials, q]);
  const busy = r.status === "uploading" || r.status === "extracting" || r.status === "matching";
  const targetName = r.candidates.find((c) => c.id === r.selectedRm)?.name ?? materials.find((m) => m.id === r.selectedRm)?.name ?? null;
  const editable = canWrite && !locked && r.status === "ready" && r.applyState !== "applied" && r.applyState !== "applying";

  return (
    <li className="flex flex-col gap-2 p-3 md:p-4" data-file={r.file.name}>
      <div className="flex items-start gap-3">
        {r.status === "error" || r.applyState === "failed" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden /> : <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" aria-hidden />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={r.file.name}>{r.file.name}</div>
          <div className="text-xs text-ink-secondary">
            {r.status === "pending" && "Venter"}
            {r.status === "uploading" && "Laster opp…"}
            {r.status === "extracting" && "AI leser databladet…"}
            {r.status === "matching" && "Matcher…"}
            {r.status === "ready" && r.applyState === "idle" && (r.candidates.length > 0 ? `${r.candidates.length} kandidat${r.candidates.length === 1 ? "" : "er"}` : "Ingen match funnet")}
            {r.applyState === "applying" && "Anvender…"}
            {r.applyState === "applied" && <span className="text-success">Anvendt på {targetName ?? "råvaren"}</span>}
          </div>
        </div>
        {busy && <Loader2 className="mt-0.5 h-4 w-4 animate-spin" aria-hidden />}
      </div>

      {r.summary && r.status === "ready" && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-ink-secondary">
          <span className="font-medium text-foreground">AI leste:</span> {r.summary.name ?? "uten navn"}{r.summary.supplier ? ` · ${r.summary.supplier}` : ""}
          {" · "}næring: {r.summary.nutritionFields > 0 ? `${r.summary.nutritionFields} verdier` : "ingen"}
          {" · "}allergener: {r.summary.allergens.length > 0 ? r.summary.allergens.join(", ") : "ingen funnet"}
          {r.summary.declaration && <> · deklarasjon: «{r.summary.declaration.slice(0, 80)}{r.summary.declaration.length > 80 ? "…" : ""}»</>}
          {r.summary.grain && " · korn"}
          {r.summary.packageText && ` · pakning: ${r.summary.packageText} (lagres ikke her)`}
          <div className="mt-1">Skrives ved anvend: {BULK_FIELDS.map((f) => FIELD_LABEL[f]).join(", ")}. Pakning, sammensetning og allergenfjerning skrives aldri herfra.</div>
        </div>
      )}

      {r.status === "ready" && r.applyState !== "applied" && (
        <fieldset className="space-y-1" disabled={!editable}>
          <legend className="text-xs font-medium">Mål for databladet</legend>
          {r.candidates.map((c) => (
            <label key={c.id} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/40 md:min-h-9">
              <input type="radio" name={`mal-${r.key}`} checked={r.selectedRm === c.id} onChange={() => onSelect(c.id, c.id !== r.candidates[0]?.id)} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="font-mono text-xs text-ink-secondary">{c.sku}</span>
              <Badge variant="outline" className="text-xs">{pct(c.score)}</Badge>
            </label>
          ))}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-secondary" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søk annen råvare…" className="h-11 pl-8 md:h-9" aria-label={`Søk råvare for ${r.file.name}`} />
          </div>
          {results.map((m) => (
            <button key={m.id} type="button" className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted/40 md:min-h-9" onClick={() => { onSelect(m.id, true); setQ(""); }}>
              <span className="min-w-0 flex-1 truncate">{m.name}</span><span className="font-mono text-xs text-ink-secondary">{m.sku}</span>
            </button>
          ))}
          {r.selectedRm && <p className="text-xs">Valgt: <span className="font-medium">{targetName ?? "råvare"}</span>{r.manualTarget && " — manuelt valgt, må anvendes enkeltvis"}</p>}
        </fieldset>
      )}

      {(r.error && r.status === "error") && <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive [overflow-wrap:anywhere]">{r.error}</p>}
      {r.applyError && r.applyState === "failed" && <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive [overflow-wrap:anywhere]">Ikke anvendt: {r.applyError}</p>}
      {r.followUps.length > 0 && <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs">Manuell oppfølging: {r.followUps.join(" · ")}</p>}
      {r.packageSuggestion && canWrite && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
          <span>Pakning {r.packageSuggestion.size ?? "—"} {r.packageSuggestion.unit ?? ""} foreslått — ikke lagret</span>
          <Button size="sm" variant="outline" className="h-11 md:h-7" disabled={locked} onClick={onOpenPackage}>Bekreft pakning…</Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {editable && r.selectedRm && (
          <Button size="sm" className="h-11 md:h-8" onClick={onApply}><Check className="mr-1 h-3.5 w-3.5" aria-hidden />{r.applyState === "failed" ? "Prøv anvend igjen" : "Koble og anvend"}</Button>
        )}
        {editable && !r.selectedRm && r.datasheet_id && (
          <Button size="sm" variant="outline" className="h-11 md:h-8" onClick={onCreate}><Plus className="mr-1 h-3.5 w-3.5" aria-hidden />Opprett ny råvare</Button>
        )}
        {r.status === "error" && canWrite && !locked && (
          <Button size="sm" variant="outline" className="h-11 md:h-8" onClick={onRetry}><RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />Prøv igjen{r.datasheet_id ? " (uten ny AI-lesing)" : ""}</Button>
        )}
      </div>
    </li>
  );
}
