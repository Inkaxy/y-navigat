import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/hooks/useCompany";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";
import { parseDecimal } from "@/fakturaer/lib/units";
import { pendingDelete, pendingInsert, pendingPatch } from "@/lib/pendingRpc";
import type { KeyLimit } from "@/ravarer/lib/automatikk";
import { AUTO_KEY, useKeyLimits } from "./useAutomatikk";

const pctText = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));

/** Nøkkelråvarer med egen grense (B7). Lagres per råvare; matchingen tar dem i bruk i et eget, gjennomgått trinn. */
export function KeyMaterialsCard({ canEdit }: { canEdit: boolean }) {
  const q = useKeyLimits();
  return (
    <section aria-labelledby="nokkel-tittel" className="space-y-2 rounded-2xl border border-line-subtle bg-card p-4">
      <h2 id="nokkel-tittel" className="text-body font-semibold">Nøkkelråvarer med egen grense</h2>
      <p className="text-caption text-ink-secondary">Varene som betyr mest. Systemet spør deg ved mindre endringer enn for andre varer.</p>
      {q.cap === false ? <p className="text-caption text-ink-secondary">Venter på databaseendringen for Automatikk.</p>
        : q.cap == null ? <p className="text-caption text-ink-secondary">Sjekker …</p>
        : q.isError ? <p role="alert" className="text-sm text-destructive">Kunne ikke hente nøkkelråvarene.</p>
        : !q.data ? <p className="text-sm text-ink-secondary">Henter …</p>
        : <>
          {q.data.length === 0 && <p className="text-sm text-ink-secondary">Ingen nøkkelråvarer ennå.</p>}
          <ul className="divide-y divide-line-subtle">{q.data.map((k) => <LimitRow key={`${k.id}|${k.maxPct}`} k={k} canEdit={canEdit} />)}</ul>
          {canEdit && <AddLimit existing={q.data.map((k) => k.rawMaterialId)} />}
          <p className="text-caption text-ink-secondary">Grensene er lagret, men matchingen bruker dem først etter neste gjennomgåtte oppdatering. Til da gjelder de vanlige grensene.</p>
        </>}
    </section>
  );
}

function LimitRow({ k, canEdit }: { k: KeyLimit; canEdit: boolean }) {
  const qc = useQueryClient();
  const [v, setV] = useState(pctText(k.maxPct));
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const lock = useRef(false);
  const n = parseDecimal(v);
  const ok = n != null && n >= 0 && n <= 500;
  const dirty = n !== k.maxPct;
  const act = async (fn: () => ReturnType<typeof pendingPatch>) => {
    if (lock.current) return;
    lock.current = true; setMsg(null);
    try { const r = await fn(); if (r.kind === "ok") void qc.invalidateQueries({ queryKey: [...AUTO_KEY, "nokkelravarer"] }); else setMsg(r.kind === "denied" ? "Bare administrator kan endre dette." : "Utfallet er ukjent. Hent siden på nytt."); }
    finally { lock.current = false; }
  };
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <span className="min-w-0 flex-1 text-sm font-medium">{k.name}</span>
      <Label htmlFor={`kl-${k.id}`} className="text-caption text-ink-secondary">Spør meg over</Label>
      <Input id={`kl-${k.id}`} className="h-11 w-20" inputMode="decimal" value={v} disabled={!canEdit} onChange={(e) => setV(e.target.value)} />
      <span className="text-caption">%</span>
      {canEdit && dirty && <Button size="sm" className="min-h-[44px]" disabled={!ok} onClick={() => void act(() => pendingPatch("rm_key_material_limits", `id=eq.${k.id}`, { max_increase_pct: n }))}>Lagre</Button>}
      {canEdit && (confirm
        ? <><Button size="sm" variant="destructive" className="min-h-[44px]" onClick={() => void act(() => pendingDelete("rm_key_material_limits", `id=eq.${k.id}`))}>Fjern</Button><Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setConfirm(false)}>Avbryt</Button></>
        : <Button size="icon" variant="ghost" className="h-11 w-11" aria-label={`Fjern ${k.name} som nøkkelråvare`} onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" aria-hidden /></Button>)}
      {msg && <p role="alert" className="w-full text-caption text-destructive">{msg}</p>}
    </li>
  );
}

function AddLimit({ existing }: { existing: string[] }) {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  const [term, setTerm] = useState("");
  const [pct, setPct] = useState("2");
  const [msg, setMsg] = useState<string | null>(null);
  const debounced = useDebouncedValue(term.trim(), 250);
  const lock = useRef(false);
  const hits = useQuery({
    queryKey: [...AUTO_KEY, "rm-sok", le, debounced],
    enabled: !!le && debounced.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.from("raw_materials").select("id, name").eq("legal_entity_id", le!).eq("is_active", true).ilike("name", `%${debounced.replace(/[%_]/g, "")}%`).order("name").limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });
  const n = parseDecimal(pct);
  const add = async (id: string) => {
    if (lock.current || !le || n == null || n < 0 || n > 500) return;
    lock.current = true; setMsg(null);
    try {
      const r = await pendingInsert("rm_key_material_limits", { legal_entity_id: le, raw_material_id: id, max_increase_pct: n });
      if (r.kind === "ok") { setTerm(""); void qc.invalidateQueries({ queryKey: [...AUTO_KEY, "nokkelravarer"] }); }
      else setMsg(r.kind === "denied" ? "Bare administrator kan legge til." : "Kunne ikke legge til. Den kan allerede finnes – hent siden på nytt.");
    } finally { lock.current = false; }
  };
  return (
    <div className="space-y-2 border-t border-line-subtle pt-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_7rem]">
        <div className="space-y-1"><Label htmlFor="kl-sok">Legg til nøkkelråvare</Label><Input id="kl-sok" className="h-11" placeholder="Søk råvare" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="kl-ny-pct">Grense (%)</Label><Input id="kl-ny-pct" className="h-11" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></div>
      </div>
      {hits.data && hits.data.length > 0 && (
        <ul className="rounded-lg border border-line-subtle">
          {hits.data.filter((h) => !existing.includes(h.id)).map((h) => (
            <li key={h.id}><button type="button" className="min-h-[44px] w-full px-3 text-left text-sm hover:bg-muted/40" onClick={() => void add(h.id)}>{h.name}</button></li>
          ))}
        </ul>
      )}
      {msg && <p role="alert" className="text-caption text-destructive">{msg}</p>}
    </div>
  );
}
