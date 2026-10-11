import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCompany } from "@/hooks/useCompany";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { invalidateAfterLink, linkSupplierItem } from "@/fakturaer/hooks/useSupplierItems";
import { CANONICAL_BASE_UNITS } from "@/fakturaer/lib/units";
import type { BulkRowReport } from "@/fakturaer/lib/bulkLink";
import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";
import { NOT_A_PRODUCT_REASONS } from "@/ravarer/lib/notAProductReasons";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import { CONFIRM_ABOVE_LINES, eligible, previewLines, runBulk, type BulkAction } from "./bulkGjore";
import { loadPreviews, type CardPreview } from "./bulkPreview";

type Props = { selected: WorkItem[]; onClear: () => void };

/** Masseutvalg i Å gjøre: varekort på tvers av fakturaer og leverandører. Forhåndsvisning før kjøring. */
export function GjoreBulkBar({ selected, onClear }: Props) {
  const { data: company } = useCompany();
  const { canWrite } = useInvoiceRights();
  const qc = useQueryClient();
  const [kind, setKind] = useState<BulkAction["kind"] | null>(null);
  const [reason, setReason] = useState<string>(NOT_A_PRODUCT_REASONS[0]);
  const [category, setCategory] = useState("");
  const [baseUnit, setBaseUnit] = useState("kg");
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<BulkRowReport[] | null>(null);
  // Fryst forhåndsvisning (bare lesing): nøyaktige linje-ID-er og forslag per varekort.
  const [previews, setPreviews] = useState<Map<string, CardPreview> | null>(null);
  const [choices, setChoices] = useState<Map<string, string>>(new Map());
  if (selected.length === 0 && !report) return null;

  const scope = kind ? eligible(selected, kind) : { ok: [], skipped: [] };
  const lines = previews ? previewLines(scope.ok, previews) : 0;
  const godtaCount = kind === "godta" ? scope.ok.filter((it) => choices.has(it.key)).length : 0;
  const needsConfirm = lines > CONFIRM_ABOVE_LINES;
  const ready = !!company && canWrite && !!previews && lines > 0 && (!needsConfirm || confirmed)
    && (kind !== "opprett" || (!!category && !!baseUnit)) && (kind !== "godta" || godtaCount > 0) && !progress;

  const open = (k: BulkAction["kind"]) => {
    setKind(k); setConfirmed(false); setReport(null); setPreviews(null); setChoices(new Map());
    if (!company) return;
    const items = eligible(selected, k).ok;
    void loadPreviews(items, company.id, k === "godta").then((pv) => {
      setPreviews(pv);
      const m = new Map<string, string>();
      for (const it of items) { const u = pv.get(it.key)?.unambiguous; if (u) m.set(it.key, u.id); }
      setChoices(m);
    });
  };
  const run = async () => {
    if (!company || !kind || !previews) return;
    const action: BulkAction = kind === "ikke_vare" ? { kind, reason } : kind === "godta" ? { kind, choices } : { kind, category, baseUnit };
    setProgress({ done: 0, total: scope.ok.length });
    const r = await runBulk(scope.ok, action, company.id, linkSupplierItem, (done, total) => setProgress({ done, total }), previews);
    setProgress(null);
    setReport(r);
    invalidateAfterLink(qc);
    void qc.invalidateQueries({ queryKey: ["ravarer", "work-items"] });
    void qc.invalidateQueries({ queryKey: ["ravarer", "work-summary"] });
  };
  const close = () => { setKind(null); setPreviews(null); if (report) { setReport(null); onClear(); } };

  return (
    <>
      {selected.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span className="font-medium">{selected.length} valgt</span>
          <Button size="sm" variant="outline" disabled={!canWrite} onClick={() => open("ikke_vare")}>Ikke vare …</Button>
          <Button size="sm" variant="outline" disabled={!canWrite} onClick={() => open("opprett")}>Opprett råvarer …</Button>
          <Button size="sm" variant="outline" disabled={!canWrite} onClick={() => open("godta")}>Godta forslag …</Button>
          <Button size="sm" variant="ghost" onClick={onClear}>Fjern utvalg</Button>
        </div>
      )}
      <Dialog open={kind !== null} onOpenChange={(v) => { if (!v && !progress) close(); }}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{kind === "opprett" ? "Opprett råvarer fra valgte varekort" : kind === "godta" ? "Godta forslag for valgte varekort" : "Merk valgte varekort som ikke vare"}</DialogTitle>
            <DialogDescription>{previews
              ? `Gjelder ${scope.ok.length} varekort med ${lines} åpne ${lines === 1 ? "linje" : "linjer"} slik de ser ut nå. Bare disse linjene endres; linjer som kommer til senere røres ikke. Kjøres ett og ett med samme regler som enkeltvis.`
              : "Henter linjene som vises nå …"}</DialogDescription>
          </DialogHeader>
          {report ? (
            <ul className="space-y-1 text-sm" aria-label="Resultat per varekort">
              {report.map((r, i) => <li key={i} className={r.ok ? "" : "text-destructive"}><span className="font-medium">{r.name}</span>: {r.text}</li>)}
            </ul>
          ) : (
            <div className="space-y-3 text-sm">
              <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border p-2">
                {scope.ok.map((it) => {
                  const pv = previews?.get(it.key);
                  return (
                    <li key={it.key} className="space-y-1 py-0.5">
                      <div className="truncate">{it.title} <span className="text-ink-secondary">· {it.supplier_name ?? "Ukjent"} · {pv ? `${pv.lineIds.length} linjer` : "…"}</span></div>
                      {kind === "godta" && pv && (pv.candidates.length === 0
                        ? <p className="text-caption text-ink-secondary">Ingen forslag – hoppes over.</p>
                        : pv.unambiguous
                          ? <p className="text-caption">Forslag: <span className="font-medium">{pv.unambiguous.name}</span>{pv.unambiguous.why ? ` – ${pv.unambiguous.why}` : ""}</p>
                          : <Select value={choices.get(it.key) ?? ""} onValueChange={(v) => setChoices((m) => new Map(m).set(it.key, v))}>
                              <SelectTrigger className="h-8" aria-label={`Velg råvare for ${it.title}`}><SelectValue placeholder="Flere forslag – velg én" /></SelectTrigger>
                              <SelectContent>{pv.candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.lines} {c.lines === 1 ? "linje" : "linjer"}){c.why ? ` – ${c.why}` : ""}</SelectItem>)}</SelectContent>
                            </Select>)}
                    </li>
                  );
                })}
              </ul>
              {scope.skipped.length > 0 && <p className="text-caption text-ink-secondary">{scope.skipped.length} valgte hoppes over ({kind === "opprett" || kind === "godta" ? "gjelder bare ukoblede varekort" : "fakturasaker kan ikke merkes"}).</p>}
              {kind === "ikke_vare" && (
                <div><Label className="mb-1 block">Årsak</Label>
                  <Select value={reason} onValueChange={setReason}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{NOT_A_PRODUCT_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
              )}
              {kind === "opprett" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label className="mb-1 block">Felles kategori</Label>
                    <Select value={category} onValueChange={setCategory}><SelectTrigger aria-label="Kategori"><SelectValue placeholder="Velg kategori" /></SelectTrigger>
                      <SelectContent><CategorySelectItems /></SelectContent></Select></div>
                  <div><Label className="mb-1 block">Grunnenhet</Label>
                    <Select value={baseUnit} onValueChange={setBaseUnit}><SelectTrigger aria-label="Grunnenhet"><SelectValue /></SelectTrigger>
                      <SelectContent>{CANONICAL_BASE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select></div>
                  <p className="text-caption text-ink-secondary sm:col-span-2">Navn hentes fra varekortet. Like navn opprettes én gang og kobles sammen. Pakning bekreftes etterpå på hvert varekort.</p>
                </div>
              )}
              {needsConfirm && (
                <label className="flex items-start gap-2"><Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
                  <span>Jeg har sett gjennom utvalget. Dette gjelder {lines} linjer og kan ikke angres samlet.</span></label>
              )}
              {progress && <p role="status">Behandler {progress.done} av {progress.total} …</p>}
            </div>
          )}
          <DialogFooter>
            {report ? <Button onClick={close}>Lukk</Button> : (
              <>
                <Button variant="outline" disabled={!!progress} onClick={close}>Avbryt</Button>
                <Button disabled={!ready} onClick={() => void run()}>{kind === "opprett" ? `Opprett (${scope.ok.length})` : kind === "godta" ? `Godta (${godtaCount})` : `Merk (${scope.ok.length})`}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
