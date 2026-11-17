import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { newOpId } from "@/lib/pendingRpc";
import { useMergeAccess, useMergeActions, useMergeFacts, type MergeRequest, type RunResult } from "@/ravarer/hooks/useMaterialMerge";
import { paths } from "@/ravarer/lib/paths";
import { rejectText, suggestKeep, type MergeFacts, type MergeOutcome } from "@/ravarer/lib/merge/facts";
import { conversionFor, conversionReady, weightPrefill } from "@/ravarer/lib/merge/units";
import { MergeCompare, type FieldChoice } from "./MergeCompare";
import { MergeConversion } from "./MergeConversion";
import { MergeSummary } from "./MergeSummary";
import { UndoMergePanel } from "./UndoMergePanel";

type Ok = Extract<MergeOutcome, { ok: true }>;
type Phase = { kind: "edit" } | { kind: "busy" } | { kind: "unknown"; req: MergeRequest; opId: string } | { kind: "done"; outcome: Ok; keepName: string };
const MAX = 11;

/**
 * «Slå sammen varer»: velg varen som beholdes, navn/kategori/type, omregning ved ulik enhet, forhåndsvisning (dry-run)
 * og bekreft. Bekreftelsen bruker den forhåndsviste, frosne forespørselen og én op_id; ukjent utfall sendes uendret på nytt.
 */
export function MergeDialog({ ids, open, onOpenChange, onMerged }: { ids: string[]; open: boolean; onOpenChange: (o: boolean) => void; onMerged?: (keepId: string) => void }) {
  const access = useMergeAccess();
  const facts = useMergeFacts(ids, open && access.ready);
  const actions = useMergeActions();
  const items = useMemo(() => (facts.data?.kind === "ok" ? facts.data.items : []), [facts.data]);
  const suggested = useMemo(() => suggestKeep(items), [items]);
  const [keepId, setKeepId] = useState("");
  const [fields, setFields] = useState<FieldChoice>({ name: "", category: "", item_type: "" });
  const [grams, setGrams] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ key: string; outcome: Ok } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const lock = useRef(false);

  useEffect(() => { if (open) { setKeepId(""); setPreview(null); setMsg(null); setPhase({ kind: "edit" }); setGrams({}); } }, [open, ids.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = items.find((i) => i.id === keepId) ?? null;
  useEffect(() => {
    if (!keepId && suggested) chooseKeep(suggested.id);
  }, [suggested]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseKeep(id: string) {
    setKeepId(id);
    setFields({ name: id, category: id, item_type: id });
    const k = items.find((i) => i.id === id);
    if (k) {
      const next: Record<string, string> = {};
      for (const d of items) if (d.id !== id) { const p = weightPrefill(k, d); if (p != null) next[d.id] = String(p).replace(".", ","); }
      setGrams(next);
    }
  }

  const dups = items.filter((i) => i.id !== keepId);
  const conversions = keep ? dups.map((d) => conversionFor(keep.base_unit, d.base_unit, grams[d.id] ?? "")) : [];
  const convOk = conversions.every(conversionReady);
  const request = useMemo((): MergeRequest | null => {
    if (!keep || dups.length === 0 || !convOk) return null;
    const gpp: Record<string, number> = {};
    dups.forEach((d, i) => { const c = conversions[i]; if (c.kind === "weight" && c.grams != null) gpp[d.id] = c.grams; });
    return { keepId: keep.id, dupIds: dups.map((d) => d.id), gramsPerPiece: gpp, fields, reason: null };
  }, [keep, dups.map((d) => d.id).join("|"), JSON.stringify(grams), JSON.stringify(fields), convOk]); // eslint-disable-line react-hooks/exhaustive-deps
  const reqKey = request ? JSON.stringify(request) : "";
  const currentPreview = preview && preview.key === reqKey ? preview.outcome : null;

  const handle = (r: RunResult): Ok | null => {
    if (r.kind === "missing") { setMsg("Databaseendringen for «Slå sammen varer» er ikke kjørt ennå. Ingenting er endret."); return null; }
    if (r.kind === "denied") { setMsg("Bare godkjenner eller administrator i Råvarer kan slå sammen varer. Ingenting er endret."); return null; }
    if (r.kind === "unknown") return null;
    if (!r.outcome.ok) {
      const extra = r.outcome.code === "omregning_mangler" && r.outcome.keepUnit && r.outcome.dupUnit ? ` (${r.outcome.dupUnit} → ${r.outcome.keepUnit})` : "";
      setMsg(`${rejectText(r.outcome.code)}${extra} ${r.outcome.conflicts.filter((c) => c.blocking).map((c) => c.text).join(" ")}`.trim());
      return null;
    }
    return r.outcome;
  };

  const runPreview = async () => {
    if (!request || lock.current) return;
    lock.current = true; setMsg(null); setPhase({ kind: "busy" });
    try {
      const r = await actions.preview(request, newOpId());
      const ok = handle(r);
      if (r.kind === "unknown") setMsg("Kunne ikke forhåndsvise. Prøv igjen.");
      if (ok) setPreview({ key: reqKey, outcome: ok });
    } finally { lock.current = false; setPhase((p) => (p.kind === "busy" ? { kind: "edit" } : p)); }
  };

  const apply = async (frozen: MergeRequest, opId: string) => {
    if (lock.current) return;
    lock.current = true; setMsg(null); setPhase({ kind: "busy" });
    try {
      const r = await actions.apply(frozen, opId);
      if (r.kind === "unknown") { setPhase({ kind: "unknown", req: frozen, opId }); return; }
      const ok = handle(r);
      if (ok && !ok.dryRun) {
        const name = items.find((i) => i.id === frozen.fields.name)?.name ?? keep?.name ?? "";
        setPhase({ kind: "done", outcome: ok, keepName: name });
        onMerged?.(ok.keepId);
        return;
      }
      setPreview(null);
      setPhase({ kind: "edit" });
    } finally { lock.current = false; }
  };

  const busy = phase.kind === "busy";
  const locked = busy || phase.kind === "unknown";
  const title = phase.kind === "done" ? "Varene er slått sammen" : "Slå sammen varer";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && busy) return; onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {phase.kind === "done" ? `Alt er flyttet til «${phase.keepName}». Varene som ble slått inn er satt inaktive og sender videre hit.`
              : "Varen som beholdes får leverandørkoblinger, varenumre, skrivemåter, fakturalinjer, priser, oppskrifter, kalkyler og lager. Nye fakturalinjer kobles hit automatisk. Ingenting slettes, og sammenslåingen kan angres."}
          </DialogDescription>
        </DialogHeader>

        {!access.allowed ? <p className="text-body">Bare godkjenner eller administrator i Råvarer kan slå sammen varer.</p>
          : access.available === false ? <p className="text-body">Venter på databaseendring («Slå sammen varer»). Ingenting kan slås sammen før den er kjørt.</p>
          : ids.length < 2 || ids.length > MAX ? <p className="text-body">Velg mellom 2 og {MAX} varer.</p>
          : facts.isLoading || access.available == null ? <p className="flex items-center gap-2 text-body"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Henter varene …</p>
          : facts.isError || facts.data?.kind === "error" ? <p role="alert" className="text-body text-destructive">{facts.data?.kind === "error" ? facts.data.text : "Kunne ikke hente varene."}</p>
          : facts.data?.kind === "missing" ? <p className="text-body">Venter på databaseendring («Slå sammen varer»).</p>
          : facts.data?.kind === "denied" ? <p className="text-body">Du har ikke tilgang til disse varene.</p>
          : phase.kind === "done" ? (
            <div className="space-y-4">
              <MergeSummary title="Flyttet" counts={phase.outcome.counts} conflicts={phase.outcome.conflicts.filter((c) => !c.blocking)} before={phase.outcome.cost.before} after={phase.outcome.cost.after} />
              {phase.outcome.mergeId && <UndoMergePanel mergeId={phase.outcome.mergeId} />}
            </div>
          ) : (
            <Body items={items} keep={keep} dups={dups} suggested={suggested} keepId={keepId} chooseKeep={(id) => { chooseKeep(id); setPreview(null); }}
              fields={fields} setFields={setFields} grams={grams} setGrams={(id, v) => setGrams((g) => ({ ...g, [id]: v }))} locked={locked} preview={currentPreview} />
          )}

        {msg && <p role="alert" className="text-caption text-destructive">{msg}</p>}
        {phase.kind === "unknown" && <p role="alert" className="text-caption text-destructive">Utfallet er ukjent. Send den samme sammenslåingen på nytt – den blir ikke gjort to ganger.</p>}

        <DialogFooter className="gap-2">
          {phase.kind === "done" ? (
            <>
              <Button variant="outline" className="min-h-[44px]" asChild><Link to={paths.raavare(phase.outcome.keepId)} onClick={() => onOpenChange(false)}>Åpne varen</Link></Button>
              <Button className="min-h-[44px]" onClick={() => onOpenChange(false)}>Ferdig</Button>
            </>
          ) : phase.kind === "unknown" ? (
            <Button className="min-h-[44px]" onClick={() => void apply(phase.req, phase.opId)}>Send på nytt</Button>
          ) : (
            <>
              <Button variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => onOpenChange(false)}>Avbryt</Button>
              {currentPreview ? (
                <Button className="min-h-[44px]" disabled={busy || !currentPreview.canApply || !request} onClick={() => request && void apply(request, newOpId())}>
                  {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Slå sammen {dups.length + 1} varer
                </Button>
              ) : (
                <Button className="min-h-[44px]" disabled={busy || !request || !access.ready} onClick={() => void runPreview()}>
                  {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Forhåndsvis
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Body({ items, keep, dups, suggested, keepId, chooseKeep, fields, setFields, grams, setGrams, locked, preview }: {
  items: MergeFacts[]; keep: MergeFacts | null; dups: MergeFacts[]; suggested: ReturnType<typeof suggestKeep>; keepId: string; chooseKeep: (id: string) => void;
  fields: FieldChoice; setFields: (f: FieldChoice) => void; grams: Record<string, string>; setGrams: (id: string, v: string) => void; locked: boolean; preview: Ok | null;
}) {
  const unusable = items.filter((i) => !i.is_active || i.merged_into_id);
  return (
    <div className="space-y-4">
      {unusable.length > 0 && <p role="alert" className="text-caption text-destructive">{unusable.map((i) => `«${i.name}»`).join(", ")} er inaktiv eller allerede slått sammen.</p>}
      <MergeCompare items={items} keepId={keepId} onKeep={chooseKeep} suggested={suggested} fields={fields} onFields={setFields} disabled={locked} />
      {keep && <MergeConversion keep={keep} dups={dups} grams={grams} onGrams={setGrams} disabled={locked} />}
      {preview ? (
        <MergeSummary title="Dette flyttes" counts={preview.counts} conflicts={preview.conflicts} before={preview.cost.before} after={preview.cost.after} />
      ) : <p className="text-caption text-ink-secondary">Forhåndsvis for å se hva som flyttes og om noe hindrer sammenslåingen. Ingenting endres før du bekrefter.</p>}
    </div>
  );
}
