import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { LineDraft, LineSaveStatus } from "../hooks";
import { entryToBase, formatAmount, formatKr, LINE_STATE_LABEL, parseNorwegianAmount } from "../logic";
import type { EntryPart, LineState, VtCountLine } from "../types";

type Field = { unit_id: string | null; label: string; units_in_base: number };

function fieldsOf(l: VtCountLine): Field[] {
  return [...l.snap_units.map(u => ({ unit_id: u.id, label: u.label, units_in_base: u.units_in_base })),
    { unit_id: null, label: l.snap_base_unit, units_in_base: 1 }];
}
function textsFrom(l: VtCountLine): string[] {
  return fieldsOf(l).map(f => {
    const p = l.entry.find(e => e.unit_id === f.unit_id);
    return p ? String(p.amount).replace(".", ",") : "";
  });
}

/** Ett tellekort: store felt, desimalkomma, eksplisitt 0 og «Må kontrolleres». Forventet beholdning vises ikke. */
export function LineEntryCard({
  line, readOnly, active, onFocus, onSave, onNext,
}: {
  line: VtCountLine; readOnly: boolean; active: boolean; onFocus: () => void;
  onSave: (line: VtCountLine, draft: LineDraft | null) => Promise<LineSaveStatus>; onNext: () => void;
}) {
  const fields = fieldsOf(line);
  const [texts, setTexts] = useState<string[]>(() => textsFrom(line));
  const [note, setNote] = useState(line.note ?? "");
  const [status, setStatus] = useState<LineSaveStatus | null>(null);
  const [baseRev, setBaseRev] = useState(line.revision);
  // Ny serverversjon (fra andre) og ingen lokal endring: ta inn ferske verdier.
  const dirty = JSON.stringify(texts) !== JSON.stringify(textsFrom(line)) || note !== (line.note ?? "");
  if (line.revision !== baseRev && !dirty && status?.kind !== "ukjent") { setBaseRev(line.revision); }

  const parsed = texts.map(t => parseNorwegianAmount(t));
  const invalid = parsed.some(p => p === "ugyldig");
  const entry: EntryPart[] = fields.flatMap((f, i) => { const p = parsed[i]; return typeof p === "number" ? [{ ...f, amount: p }] : []; });
  const total = invalid ? null : entryToBase(entry);

  const send = async (state: LineState, retry = false) => {
    const draft: LineDraft | null = retry ? null : {
      state, countedBase: state === "talt" || state === "ma_kontrolleres" ? total : null,
      entry: state === "talt" || state === "ma_kontrolleres" ? entry : [], note: note.trim() || null,
    };
    setStatus({ kind: "lagrer" });
    const s = await onSave(line, draft);
    setStatus(s);
    if (s.kind === "lagret" && state !== "ma_kontrolleres") onNext();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && total != null && !readOnly) { e.preventDefault(); void send("talt"); } };
  const busy = status?.kind === "lagrer";
  const locked = readOnly || busy || status?.kind === "ukjent";

  return (
    <Card className={"p-4 " + (active ? "ring-2 ring-ring" : "")} data-testid="vt-line" onFocusCapture={onFocus}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold break-words">{line.snap_name}</p>
          <p className="text-xs text-muted-foreground">{[line.snap_sku, line.snap_location_name ?? "Uten plassering", `baseenhet ${line.snap_base_unit}`].filter(Boolean).join(" · ")}</p>
        </div>
        <Badge variant="outline">{LINE_STATE_LABEL[line.state]}{line.counted_base != null && line.state === "talt" ? ` · ${formatAmount(line.counted_base)} ${line.snap_base_unit}` : ""}</Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        {fields.map((f, i) => (
          <label key={f.unit_id ?? "base"} className="text-sm">
            <span className="mb-1 block text-muted-foreground">{f.label}{f.unit_id ? ` (× ${formatAmount(f.units_in_base)} ${line.snap_base_unit})` : ""}</span>
            <Input inputMode="decimal" autoComplete="off" disabled={locked} value={texts[i]} onKeyDown={onKey}
              aria-label={`${line.snap_name}: antall ${f.label}`} aria-invalid={parsed[i] === "ugyldig"}
              className="h-12 text-lg tabular-nums" onChange={e => setTexts(t => t.map((x, j) => (j === i ? e.target.value : x)))} />
          </label>
        ))}
      </div>
      <p className="mt-2 text-sm" aria-live="polite">
        {invalid ? <span className="text-destructive">Ugyldig tall — bruk siffer og komma.</span>
          : total != null ? <>Sum: <strong>{formatAmount(total)} {line.snap_base_unit}</strong>
            {line.snap_price_per_base != null && <span className="text-muted-foreground"> · {formatKr(total * line.snap_price_per_base)}</span>}</>
          : <span className="text-muted-foreground">Tomt felt betyr ikke talt — ikke 0.</span>}
        {line.snap_price_per_base == null && <span className="block text-xs text-muted-foreground">{line.snap_price_source === "historisk_ikke_tilgjengelig" ? "Ingen historisk pris for telledatoen" : "Mangler verifisert pris"}</span>}
      </p>
      <Input disabled={locked} value={note} onChange={e => setNote(e.target.value)} placeholder="Kommentar"
        aria-label={`Kommentar for ${line.snap_name}`} className="mt-2 h-12" maxLength={500} />
      {!readOnly && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button className="min-h-[48px]" disabled={locked || total == null} onClick={() => void send("talt")}>Lagre</Button>
          <Button variant="outline" className="min-h-[48px]" disabled={locked} onClick={() => void send("null")}>0 på lager</Button>
          <Button variant="outline" className="min-h-[48px]" disabled={locked} onClick={() => void send("ikke_her")}>Ikke på stedet</Button>
          <Button variant="outline" className="min-h-[48px]" disabled={locked || invalid} onClick={() => void send("ma_kontrolleres")}>Må kontrolleres</Button>
          <Button variant="ghost" className="min-h-[48px]" onClick={onNext}>Neste vare</Button>
        </div>
      )}
      <div className="mt-2 text-sm" aria-live="polite">
        {status?.kind === "lagrer" && <span className="text-muted-foreground">Lagrer …</span>}
        {status?.kind === "lagret" && <span>Lagret</span>}
        {status?.kind === "avvist" && <span className="text-destructive">Kunne ikke lagre: {status.message}</span>}
        {status?.kind === "ukjent" && (
          <span className="flex flex-wrap items-center gap-2 text-destructive">{status.message}
            <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => void send(line.state, true)}>Send samme på nytt</Button></span>
        )}
        {status?.kind === "konflikt" && (
          <div className="rounded-md border border-destructive/40 p-2" role="alert">
            <p className="font-medium">Noen andre har endret linjen.</p>
            <p>Lagret nå: {LINE_STATE_LABEL[status.current.state]}{status.current.counted_base != null ? ` ${formatAmount(status.current.counted_base)} ${line.snap_base_unit}` : ""}</p>
            <p>Din verdi: {total != null ? `${formatAmount(total)} ${line.snap_base_unit}` : "tom"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => { setTexts(textsFrom(status.current)); setNote(status.current.note ?? ""); setStatus(null); }}>Bruk lagret verdi</Button>
              <Button size="sm" className="min-h-[44px]" disabled={total == null} onClick={() => { setStatus(null); void send("talt"); }}>Lagre min verdi over</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
