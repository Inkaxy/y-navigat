import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useOpAction, useVtMaterials, useVtScope } from "../hooks";
import { formatAmount, formatKr, parseNorwegianAmount, priceReasonLabel } from "../logic";
import { useStage3Api, type ClarSource, type VtClarification } from "../stage3";
import { s3Keys, useStage3Ready } from "../stage3Hooks";
import type { VtCount, VtCountLine } from "../types";
import { lineValueOre } from "../report";
import { NativeSelect, Notice } from "./shared";

const SOURCES: { id: ClarSource; label: string }[] = [
  { id: "faktura", label: "Faktura" }, { id: "leverandorpris", label: "Leverandørens pris" }, { id: "prisliste", label: "Prisliste" }, { id: "manuell_vurdering", label: "Manuell vurdering" },
];

/**
 * Prisavklaring for linjer UTEN dokumentert pris i startgrunnlaget. Godkjenner angir pris per baseenhet, kilde og
 * begrunnelse. Startgrunnlaget og globale priser endres aldri; hver avklaring lagres som egen revisjon.
 */
export function PriceClarificationPanel({ count, lines, clarifications }: { count: VtCount; lines: VtCountLine[]; clarifications: VtClarification[] }) {
  const s3 = useStage3Ready(); const { canApprove } = useVtScope();
  const missing = lines.filter(l => l.snap_price_per_base == null && (l.state === "talt" || l.state === "ma_kontrolleres" || l.state === "ikke_talt"));
  const open = count.status === "pagar" || count.status === "til_kontroll";
  if (missing.length === 0) return null;
  const counted = missing.filter(l => l.state === "talt");
  const unresolved = counted.filter(l => l.clar_price_per_base == null);
  return (
    <Card className="space-y-3 p-4" aria-label="Prisavklaring">
      <p className="font-medium">Varer uten dokumentert pris ({missing.length})</p>
      <p className="text-sm">{unresolved.length > 0 ? `${unresolved.length} talte varer mangler pris — tellingen kan ikke avsluttes før de er avklart.` : "Alle talte varer har dokumentert eller avklart pris."}</p>
      {!s3.ready ? <Notice title="Prisavklaring er ikke tatt i bruk ennå.">Blir tilgjengelig når databasedelen er godkjent og rullet ut.</Notice>
        : !canApprove ? <p className="text-sm text-muted-foreground">Bare godkjenner kan avklare priser.</p> : null}
      <ul className="space-y-2">
        {missing.map(l => <ClarRow key={l.id} line={l} history={clarifications.filter(c => c.line_id === l.id)} editable={s3.ready && canApprove && open && !!l.snap_base_unit} />)}
      </ul>
    </Card>
  );
}

function ClarRow({ line, history, editable }: { line: VtCountLine; history: VtClarification[]; editable: boolean }) {
  const api = useStage3Api(); const { entity } = useVtScope(); const qc = useQueryClient();
  const current = history.find(c => c.superseded_at == null) ?? null;
  const [edit, setEdit] = useState(false);
  const [price, setPrice] = useState(""); const [kind, setKind] = useState<ClarSource>("faktura"); const [ref, setRef] = useState(""); const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  type P = { lineId: string; expected: string | null; price: number; kind: ClarSource; ref: string | null; reason: string };
  const act = useOpAction(`clar:${line.id}`, "approve", (opId, p: P) => (api ? api.clarifyPrice({ opId, lineId: p.lineId, expectedClarification: p.expected, price: p.price, sourceKind: p.kind, sourceRef: p.ref, reason: p.reason }) : Promise.reject(new Error("utilgjengelig"))));
  const parsed = parseNorwegianAmount(price);
  const valid = typeof parsed === "number" && parsed > 0 && reason.trim().length >= 10;
  const v = lineValueOre(line);
  const submit = (p: P) => void act.execute(p, JSON.stringify(p)).then(r => {
    if (r.kind === "ok") { setEdit(false); setMsg("Pris avklart. Startgrunnlaget er uendret."); }
    else if (r.kind === "rejected" || r.kind === "unknown") setMsg(r.message);
    void qc.invalidateQueries({ queryKey: s3Keys.clars(entity, line.count_id) });
  });
  return (
    <li className="rounded-md border p-3 text-sm" data-testid="vt-clar-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium break-words">{line.snap_name}</p>
          <p className="text-xs text-muted-foreground">Opprinnelig: {priceReasonLabel(line.snap_price_reason)} · {line.state === "talt" && line.counted_base != null ? `talt ${formatAmount(line.counted_base)} ${line.snap_base_unit ?? ""}` : "ikke talt med mengde"}</p>
          {current && <p>Avklart: <strong>{formatAmount(current.price_per_base, 4)} kr/{line.snap_base_unit}</strong> ({SOURCES.find(s => s.id === current.source_kind)?.label}{current.source_ref ? `: ${current.source_ref}` : ""}) — «{current.reason}»{v != null ? ` · verdi ${formatKr(v / 100)}` : ""}</p>}
          {history.length > 1 && <p className="text-xs text-muted-foreground">{history.length - 1} tidligere avklaring(er) bevart i revisjonssporet.</p>}
          {!line.snap_base_unit && <p className="text-xs">Varen mangler gyldig baseenhet og kan ikke prissettes her.</p>}
        </div>
        {editable && !edit && <Button variant="outline" className="min-h-[44px]" onClick={() => setEdit(true)}>{current ? "Endre avklaring" : "Avklar pris"}</Button>}
      </div>
      {edit && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div><Label htmlFor={`clp-${line.id}`}>Pris per {line.snap_base_unit} (NOK eks. mva)</Label><Input id={`clp-${line.id}`} inputMode="decimal" className="h-12" value={price} onChange={e => setPrice(e.target.value)} aria-invalid={parsed === "ugyldig"} /></div>
          <div><Label htmlFor={`cls-${line.id}`}>Kilde</Label><NativeSelect id={`cls-${line.id}`} value={kind} onChange={e => setKind(SOURCES.find(s => s.id === e.target.value)?.id ?? "faktura")}>{SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</NativeSelect></div>
          <div className="sm:col-span-2"><Label htmlFor={`clr-${line.id}`}>Referanse (fakturanr., prisliste …)</Label><Input id={`clr-${line.id}`} className="h-12" value={ref} onChange={e => setRef(e.target.value)} maxLength={200} /></div>
          <div className="sm:col-span-2"><Label htmlFor={`clb-${line.id}`}>Begrunnelse (minst 10 tegn)</Label><Textarea id={`clb-${line.id}`} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} /></div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button className="min-h-[48px]" disabled={!valid || act.busy || !!act.pending} onClick={() => typeof parsed === "number" && submit({ lineId: line.id, expected: current?.id ?? null, price: parsed, kind, ref: ref.trim() || null, reason: reason.trim() })}>Lagre avklaring</Button>
            <Button variant="outline" className="min-h-[48px]" onClick={() => setEdit(false)}>Avbryt</Button>
          </div>
        </div>
      )}
      {act.pending && <Button variant="outline" className="mt-2 min-h-[44px]" onClick={() => { const p = act.pending?.payload as P | undefined; if (p) submit(p); }}>Send samme avklaring på nytt</Button>}
      {msg && <p className="mt-1" aria-live="polite">{msg}</p>}
    </li>
  );
}

/** Aktive varer som ikke er med i denne tellingen (frosset omfang). Legg dem til i listemaler for neste telling. */
export function MissingFromCount({ lines }: { lines: VtCountLine[] }) {
  const mats = useVtMaterials();
  if (!mats.data) return null;
  const inCount = new Set(lines.map(l => l.raw_material_id));
  const missing = mats.data.filter(m => m.is_active && !inCount.has(m.id)).sort((a, b) => a.name.localeCompare(b.name, "nb"));
  return (
    <details className="rounded-lg border bg-card p-3 text-sm">
      <summary className="min-h-[44px] cursor-pointer py-2 font-medium">Aktive varer som ikke er med i denne tellingen ({missing.length})</summary>
      <p className="text-xs text-muted-foreground">Omfanget ble frosset ved start. Legg varene i en listemal under «Varer uten liste» for neste telling.</p>
      <ul className="mt-1 max-h-64 overflow-y-auto">{missing.map(m => <li key={m.id} className="py-1 break-words">{m.name}{m.sku ? ` · ${m.sku}` : ""}</li>)}</ul>
    </details>
  );
}
