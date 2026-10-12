import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { lineKey, useDraftStore, useLineSaver, usePendingOp, type LineDraft, type LinePayload, type LineSaveStatus } from "../hooks";
import { entryToBase, formatAmount, formatKr, LINE_STATE_LABEL, parseNorwegianAmount, priceReasonLabel } from "../logic";
import type { EntryInput, LineState, VtCountLine } from "../types";

type Field = { unit_id: string | null; label: string; units_in_base: number };
interface Baseline { revision: number; texts: string[]; note: string }

function fieldsOf(l: VtCountLine): Field[] {
  const units = l.snap_units.map(u => ({ unit_id: u.id, label: u.label, units_in_base: u.units_in_base }));
  return l.snap_base_unit ? [...units, { unit_id: null, label: l.snap_base_unit, units_in_base: 1 }] : [];
}
function textsFrom(l: VtCountLine, entry: { unit_id: string | null; amount: number }[] = l.entry): string[] {
  return fieldsOf(l).map(f => { const p = entry.find(e => e.unit_id === f.unit_id); return p ? String(p.amount).replace(".", ",") : ""; });
}
const baselineOf = (l: VtCountLine): Baseline => ({ revision: l.revision, texts: textsFrom(l), note: l.note ?? "" });
const valueText = (l: VtCountLine) => `${LINE_STATE_LABEL[l.state]}${l.counted_base != null && l.state !== "null" ? ` ${formatAmount(l.counted_base)} ${l.snap_base_unit ?? ""}` : ""}`;

/**
 * Ett tellekort. Utkastet er bundet til revisjonen det ble startet fra; nyere serverversjon tas bare inn
 * når kortet er rent. Lagring sender alltid grunnrevisjonen, aldri nyeste props. Forventet beholdning vises ikke.
 */
export function LineEntryCard({ line, countId, readOnly, active, onFocus, onNext }: {
  line: VtCountLine; countId: string; readOnly: boolean; active: boolean; onFocus: () => void; onNext: () => void;
}) {
  const save = useLineSaver(countId);
  const { op: pending, locked } = usePendingOp(lineKey(line.id));
  const pendingPayload = pending?.payload as LinePayload | undefined;
  const drafts = useDraftStore();
  const fields = fieldsOf(line);
  // Holdbart utkast (overlever liste/filter/fane/omlasting) vinner over serververdi; sendt-ukjent vinner over utkast.
  const [initial] = useState(() => {
    if (pendingPayload) { const t = textsFrom(line, pendingPayload.draft.entry); const n = pendingPayload.draft.note ?? "";
      return { base: { revision: pendingPayload.expectedRevision, texts: t, note: n }, texts: t, note: n }; }
    const d = drafts.get(line.id);
    if (d && d.countId === countId && d.texts.length === fields.length) return { base: { revision: d.baseRevision, texts: d.baseTexts, note: d.baseNote }, texts: d.texts, note: d.note };
    const b = baselineOf(line); return { base: b, texts: b.texts, note: b.note };
  });
  const [base, setBase] = useState<Baseline>(initial.base);
  const [texts, setTexts] = useState<string[]>(initial.texts);
  const [note, setNote] = useState(initial.note);
  const [status, setStatus] = useState<LineSaveStatus | null>(() => (pending ? { kind: "ukjent", message: "Forrige lagring har ukjent utfall." } : null));
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const dirty = JSON.stringify(texts) !== JSON.stringify(base.texts) || note !== base.note;
  const stale = line.revision !== base.revision;
  useEffect(() => {
    if (pending) return;
    if (dirty) drafts.put({ countId, lineId: line.id, baseRevision: base.revision, baseTexts: base.texts, baseNote: base.note, texts, note, at: new Date().toISOString() });
    else drafts.remove(line.id);
  }, [dirty, texts, note, base, pending, drafts, countId, line.id]);
  // Ren + ingen ventende sending: ta inn fersk serverversjon (både tall og kommentar).
  useEffect(() => {
    if (stale && !dirty && !pending && status?.kind !== "konflikt") {
      const b = baselineOf(line); setBase(b); setTexts(b.texts); setNote(b.note);
    }
  }, [stale, dirty, pending, status, line]);

  const adoptServer = (l: VtCountLine) => { const b = baselineOf(l); setBase(b); setTexts(b.texts); setNote(b.note); setStatus(null); drafts.remove(l.id); };
  const keepMineOn = (l: VtCountLine) => { setBase(b => ({ ...b, revision: l.revision })); setStatus(null); };

  const parsed = texts.map(t => parseNorwegianAmount(t));
  const invalid = parsed.some(p => p === "ugyldig");
  const entry: EntryInput[] = fields.flatMap((f, i) => { const p = parsed[i]; return typeof p === "number" ? [{ unit_id: f.unit_id, amount: p }] : []; });
  const total = invalid ? null : entryToBase(entry.map(e => ({ amount: e.amount, units_in_base: fields.find(f => f.unit_id === e.unit_id)?.units_in_base ?? NaN })));

  const send = async (state: LineState | null) => {
    let payload: LinePayload | null = null;
    if (state) {
      const withQty = state === "talt" || state === "ma_kontrolleres";
      const draft: LineDraft = { state, countedBase: withQty && entry.length ? total : null, entry: withQty ? entry : [], note: note.trim() || null };
      payload = { lineId: line.id, countId, expectedRevision: base.revision, draft };
    }
    setStatus({ kind: "lagrer" });
    const s = await save(payload, line.id);
    if (!mounted.current) return;
    setStatus(s);
    if (s.kind === "lagret") {
      if (payload) {
        // Bekreftet tilstand uten mengde (0/ikke på stedet) tømmer feltene, ellers ville gammel sum bli stående.
        const kept = payload.draft.entry.length ? texts : fields.map(() => "");
        const n = payload.draft.note ?? "";
        setBase({ revision: base.revision + 1, texts: kept, note: n }); setTexts(kept); setNote(n);
        drafts.remove(line.id);
      }
      if (state !== "ma_kontrolleres") onNext();
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && total != null && total > 0 && !readOnly) { e.preventDefault(); void send("talt"); } };
  const busy = status?.kind === "lagrer" || locked;
  const blocked = readOnly || busy || !!pending || status?.kind === "konflikt" || (stale && dirty);

  return (
    <Card className={"p-4 " + (active ? "ring-2 ring-ring" : "")} data-testid="vt-line" onFocusCapture={onFocus}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold break-words">{line.snap_name}</p>
          <p className="text-xs text-muted-foreground">{[line.snap_sku, line.snap_location_name ?? "Uten plassering", line.snap_base_unit ? `baseenhet ${line.snap_base_unit}` : "ukjent baseenhet"].filter(Boolean).join(" · ")}</p>
        </div>
        <Badge variant="outline">{valueText(line)}</Badge>
      </div>
      {fields.length === 0 && <p className="mt-3 text-sm">Varen har ingen gyldig baseenhet. Registrer «0 på lager», «Ikke på stedet» eller «Må kontrolleres».</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        {fields.map((f, i) => (
          <label key={f.unit_id ?? "base"} className="text-sm">
            <span className="mb-1 block text-muted-foreground">{f.label}{f.unit_id ? ` (× ${formatAmount(f.units_in_base)} ${line.snap_base_unit})` : ""}</span>
            <Input inputMode="decimal" autoComplete="off" disabled={blocked} value={texts[i] ?? ""} onKeyDown={onKey}
              aria-label={`${line.snap_name}: antall ${f.label}`} aria-invalid={parsed[i] === "ugyldig"}
              className="h-12 text-lg tabular-nums" onChange={e => setTexts(t => t.map((x, j) => (j === i ? e.target.value : x)))} />
          </label>
        ))}
      </div>
      <p className="mt-2 text-sm" aria-live="polite">
        {invalid ? <span className="text-destructive">Ugyldig tall — bruk siffer og komma.</span>
          : total != null ? <>Sum: <strong>{formatAmount(total)} {line.snap_base_unit}</strong>
            {total === 0 && <span className="block text-xs">Mengde 0 — bruk «0 på lager».</span>}
            {line.snap_price_per_base != null && total > 0 && <span className="text-muted-foreground"> · {formatKr(total * line.snap_price_per_base)}</span>}</>
          : <span className="text-muted-foreground">Tomt felt betyr ikke talt — ikke 0.</span>}
        {line.snap_price_per_base == null && <span className="block text-xs text-muted-foreground">Uten pris: {priceReasonLabel(line.snap_price_reason)}</span>}
      </p>
      <Input disabled={blocked} value={note} onChange={e => setNote(e.target.value)} placeholder="Kommentar"
        aria-label={`Kommentar for ${line.snap_name}`} className="mt-2 h-12" maxLength={500} />
      {!readOnly && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button className="min-h-[48px]" disabled={blocked || total == null || total <= 0} aria-describedby="vt-next-hint" onClick={() => void send("talt")}>Lagre og neste</Button>
          <Button variant="outline" className="min-h-[48px]" disabled={blocked} onClick={() => void send("null")}>0 på lager</Button>
          <Button variant="outline" className="min-h-[48px]" disabled={blocked} onClick={() => void send("ikke_her")}>Ikke på stedet</Button>
          <Button variant="outline" className="min-h-[48px]" disabled={blocked || invalid} onClick={() => void send("ma_kontrolleres")}>Må kontrolleres</Button>
          <Button variant="ghost" className="min-h-[48px]" onClick={onNext}>Neste vare</Button>
        </div>
      )}
      <div className="mt-2 text-sm" aria-live="polite">
        {busy && <span className="text-muted-foreground">Lagrer …</span>}
        {!busy && dirty && !pending && <span className="block text-xs">Utkast — ikke lagret ennå (huskes i denne nettleseren).</span>}
        {!busy && status?.kind === "lagret" && <span>Lagret</span>}
        {!busy && status?.kind === "avvist" && <span className="text-destructive">Kunne ikke lagre: {status.message}</span>}
        {!busy && pending && (
          <span className="flex flex-wrap items-center gap-2 text-destructive" role="alert">
            {status?.kind === "ukjent" ? status.message : "Forrige lagring har ukjent utfall."}
            {!readOnly && <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => void send(null)}>Send samme på nytt</Button>}
          </span>
        )}
        {stale && dirty && !pending && status?.kind !== "konflikt" && (
          <div className="rounded-md border border-destructive/40 p-2" role="alert">
            <p className="font-medium">Linjen er endret etter at du begynte.</p>
            <p>Lagret nå: {valueText(line)}{line.note ? ` · «${line.note}»` : ""}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => adoptServer(line)}>Bruk lagret verdi</Button>
              <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => keepMineOn(line)}>Behold min og fortsett</Button>
            </div>
          </div>
        )}
        {status?.kind === "konflikt" && (
          <div className="rounded-md border border-destructive/40 p-2" role="alert">
            <p className="font-medium">Noen andre har endret linjen. Ingenting ble overskrevet.</p>
            <p>Lagret nå: {valueText(status.current)}{status.current.note ? ` · «${status.current.note}»` : ""}</p>
            <p>Din verdi: {total != null ? `${formatAmount(total)} ${line.snap_base_unit ?? ""}` : "ingen mengde"}{note ? ` · «${note}»` : ""}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => adoptServer(status.current)}>Bruk lagret verdi</Button>
              <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => keepMineOn(status.current)}>Behold min og lagre på nytt</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
