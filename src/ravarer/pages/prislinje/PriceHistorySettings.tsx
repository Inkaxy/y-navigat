import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/hooks/useCompany";
import { parseDecimal } from "@/fakturaer/lib/units";
import { pendingInsert, pendingPatch } from "@/lib/pendingRpc";
import type { PriceHistorySettings as S } from "@/ravarer/hooks/usePrislinje";

const txt = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));

/**
 * Avviksgrense og standardperiode for «Alle priser» (admin). Kladd med Lagre/Forkast; tomt felt =
 * standard (kategoriens toleranse / 12 måneder). Skriver bare de to nye kolonnene.
 */
export function PriceHistorySettings({ value, canEdit }: { value: S; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const [dev, setDev] = useState(txt(value.deviationPct));
  const [months, setMonths] = useState(txt(value.sinceMonths));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => { setDev(txt(value.deviationPct)); setMonths(txt(value.sinceMonths)); }, [value.deviationPct, value.sinceMonths]);
  const d = dev.trim() === "" ? null : parseDecimal(dev);
  const m = months.trim() === "" ? null : parseDecimal(months);
  const errors: string[] = [];
  if (dev.trim() !== "" && (d == null || d < 0 || d > 500)) errors.push("Avviksgrensen må være mellom 0 og 500 %, eller tom.");
  if (months.trim() !== "" && (m == null || !Number.isInteger(m) || m < 1 || m > 120)) errors.push("Perioden må være et helt antall måneder (1–120), eller tom.");
  const dirty = d !== value.deviationPct || m !== value.sinceMonths;

  const save = async () => {
    if (lock.current || !company || errors.length || !dirty) return;
    lock.current = true; setBusy(true); setMsg(null);
    try {
      const body = { price_history_deviation_pct: d, price_history_since_months: m };
      let r = await pendingPatch("invoice_match_settings", `legal_entity_id=eq.${company.id}`, body);
      if (r.kind === "ok" && Array.isArray(r.data) && r.data.length === 0) r = await pendingInsert("invoice_match_settings", { legal_entity_id: company.id, ...body });
      if (r.kind === "ok") { setMsg({ ok: true, text: "Lagret." }); void qc.invalidateQueries({ queryKey: ["ravarer", "prishistorikk-innstillinger"] }); }
      else setMsg({ ok: false, text: r.kind === "denied" ? "Bare administrator kan endre dette." : r.kind === "missing" ? "Venter på databaseendringen for Prislinje." : "Utfallet er ukjent. Last inn siden og kontroller verdiene." });
    } finally { lock.current = false; setBusy(false); }
  };

  return (
    <details className="rounded-xl border border-line-subtle bg-card p-3">
      <summary className="min-h-[44px] cursor-pointer content-center text-sm font-semibold">Avviksgrense i prishistorikken</summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="ph-avvik">Merk priser som avviker mer enn (%)</Label>
          <Input id="ph-avvik" inputMode="decimal" className="h-11" value={dev} disabled={!canEdit || busy} onChange={(e) => setDev(e.target.value)} placeholder="Kategoriens toleranse" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ph-siden">Vis priser siden (måneder tilbake)</Label>
          <Input id="ph-siden" inputMode="numeric" className="h-11" value={months} disabled={!canEdit || busy} onChange={(e) => setMonths(e.target.value)} placeholder="12" />
        </div>
      </div>
      <p className="mt-2 text-caption text-ink-secondary">Tomt felt betyr standard. Perioden har ingen nedre grense – «Alle» i listen viser alt.</p>
      {errors.map((e) => <p key={e} role="alert" className="text-caption text-destructive">{e}</p>)}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-caption" : "text-caption text-destructive"}>{msg.text}</p>}
      {canEdit ? (
        <div className="mt-2 flex gap-2">
          <Button className="min-h-[44px]" disabled={!dirty || errors.length > 0 || busy} onClick={() => void save()}>Lagre</Button>
          <Button variant="ghost" className="min-h-[44px]" disabled={!dirty || busy} onClick={() => { setDev(txt(value.deviationPct)); setMonths(txt(value.sinceMonths)); }}>Forkast</Button>
        </div>
      ) : <p className="mt-2 text-caption text-ink-secondary">Bare administrator kan endre dette.</p>}
    </details>
  );
}
