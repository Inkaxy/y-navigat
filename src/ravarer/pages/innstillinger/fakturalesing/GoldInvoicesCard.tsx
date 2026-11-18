import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryEmptyState, QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";
import { supabase } from "@/integrations/supabase/client";
import { callPendingRpc } from "@/lib/pendingRpc";
import { formatDate } from "@/ravarer/lib/constants";
import { READER_CODE_DEPLOYED, unwrapPending, useGoldInvoices, saveCodeText } from "@/ravarer/lib/fakturalesing/readingApi";

interface Found { id: string; invoiceNumber: string; supplier: string | null; sumStatus: string | null }

/** C5: fasitfakturaer. Linjene fryses ved merking; måling skjer i måleverktøyet (invoice-model-eval). */
export function GoldInvoicesCard({ legalEntityId }: { legalEntityId: string }) {
  const q = useGoldInvoices(legalEntityId);
  const [number, setNumber] = useState("");
  const [note, setNote] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "feil"; text: string } | null>(null);
  const lock = useRef(false);

  const search = async () => {
    const n = number.trim();
    if (!n || lock.current) return;
    lock.current = true; setBusy(true); setMsg(null); setFound(null);
    try {
      const { data, error } = await supabase.from("invoices").select("id, invoice_number, lines_sum_status, suppliers(name)")
        .eq("legal_entity_id", legalEntityId).eq("invoice_number", n).limit(10);
      if (error) throw new Error("Kunne ikke søke etter fakturaen.");
      setFound((data ?? []).map((r) => ({ id: r.id, invoiceNumber: r.invoice_number ?? n, supplier: r.suppliers?.name ?? null, sumStatus: r.lines_sum_status })));
    } catch (e) {
      setMsg({ tone: "feil", text: e instanceof Error ? e.message : "Søket feilet." });
    } finally { lock.current = false; setBusy(false); }
  };

  const run = async (fn: string, args: Record<string, unknown>, done: string) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMsg(null);
    try {
      const v = unwrapPending(await callPendingRpc(fn, args));
      const ok = v && typeof v === "object" && !Array.isArray(v) && "ok" in v ? v.ok : null;
      if (ok === true) { setMsg({ tone: "ok", text: done }); setFound(null); setNumber(""); setNote(""); }
      else if (ok === false && "code" in (v as object)) setMsg({ tone: "feil", text: saveCodeText(String((v as { code: unknown }).code)) });
      else setMsg({ tone: "feil", text: "Utfallet er ukjent. Last inn på nytt og kontroller." });
    } catch (e) {
      setMsg({ tone: "feil", text: e instanceof Error ? e.message : "Lagringen feilet." });
    } finally { await q.refetch(); lock.current = false; setBusy(false); }
  };

  return (
    <Card id="innst-fakturalesing-fasit">
      <CardHeader>
        <CardTitle>Fasitsett og måling</CardTitle>
        <CardDescription>Merk fakturaer der linjene er kontrollert mot originalen. Linjene fryses ved merkingen. Ingen endring i leseregler eller modell skal tas i bruk uten en måling mot fasit som viser at den ikke er dårligere.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="gold-number">Fakturanummer</Label>
            <Input id="gold-number" value={number} onChange={(e) => setNumber(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} className="min-h-[44px] w-48" />
          </div>
          <div className="min-w-[200px] flex-1 space-y-1">
            <Label htmlFor="gold-note">Merknad (valgfri)</Label>
            <Input id="gold-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[44px]" />
          </div>
          <Button variant="outline" className="min-h-[44px]" disabled={busy || !number.trim()} onClick={() => void search()}>Finn faktura</Button>
        </div>
        {found && found.length === 0 && <p className="text-sm text-muted-foreground">Fant ingen faktura med dette nummeret.</p>}
        {found && found.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
            <span>{f.supplier ?? "Uten leverandør"} · {f.invoiceNumber}{f.sumStatus === "mismatch" ? " · summen stemmer ikke" : ""}</span>
            <Button className="min-h-[44px]" disabled={busy} onClick={() => void run("rm_mark_gold_invoice", { p_invoice_id: f.id, p_note: note.trim() || null }, `Faktura ${f.invoiceNumber} er merket som fasit.`)}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Merk som fasit
            </Button>
          </div>
        ))}
        {msg && <p role={msg.tone === "feil" ? "alert" : "status"} className={msg.tone === "feil" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{msg.text}</p>}
        {q.isError ? <QueryErrorState error={q.error} scope="fakturalesing-fasit" onRetry={() => void q.refetch()} title="Kunne ikke hente fasitfakturaene" />
          : !q.data ? <QueryLoadingState rows={3} />
          : q.data.length === 0 ? <QueryEmptyState title="Ingen fasitfakturaer ennå" />
          : (
            <ul className="divide-y">
              {q.data.map((g) => (
                <li key={g.invoiceId} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className="font-medium">{g.supplierName}</span> · {g.invoiceNumber} · {g.lineCount} linjer{g.markedAt ? ` · merket ${formatDate(g.markedAt)}` : ""}{g.note ? ` · ${g.note}` : ""}</span>
                  <Button variant="ghost" size="sm" className="min-h-[44px]" disabled={busy} onClick={() => void run("rm_unmark_gold_invoice", { p_invoice_id: g.invoiceId }, `Faktura ${g.invoiceNumber} er ikke lenger fasit.`)}>Fjern fra fasit</Button>
                </li>
              ))}
            </ul>
          )}
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {READER_CODE_DEPLOYED
            ? "Måling mot fasit kjøres fra AI-tjenester › Modellvurdering."
            : "Måleverktøyet (dagens modellvurdering utvidet med fasit, per felt og leverandør) er klart i koden, men ikke rullet ut. Det venter på ja fra Henrik."}
        </div>
      </CardContent>
    </Card>
  );
}
