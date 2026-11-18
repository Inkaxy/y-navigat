import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryEmptyState, QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/ravarer/lib/constants";
import { useExampleList, type ExampleListRow } from "@/ravarer/lib/fakturalesing/readingApi";
import { exampleChanges, exampleTitle } from "@/ravarer/lib/fakturalesing/exampleSummary";
import { EXAMPLE_KIND_LABEL } from "../../../../../supabase/functions/_shared/exampleRanking";

const ALL = "__alle__";

/** C3: menneskelige rettinger som sendes med neste lesing. Av/på per eksempel via dagens rm_set_extraction_example_active. */
export function LearningExamplesCard({ legalEntityId }: { legalEntityId: string }) {
  const q = useExampleList(legalEntityId);
  const [supplier, setSupplier] = useState(ALL);
  const suppliers = useMemo(() => [...new Map((q.data ?? []).map((r) => [r.supplierId, r.supplierName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "nb")), [q.data]);
  const rows = (q.data ?? []).filter((r) => supplier === ALL || r.supplierId === supplier);
  return (
    <Card id="innst-fakturalesing-eksempler">
      <CardHeader>
        <CardTitle>Læringseksempler</CardTitle>
        <CardDescription>Rettinger gjort av en person i Fra faktura og på fakturalinjer. Automatiske rettinger fra samlet gjenlesing blir aldri eksempler. Slå av et eksempel som ikke skal brukes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {suppliers.length > 1 && (
          <div className="max-w-xs space-y-1">
            <Label htmlFor="fl-ex-supplier">Leverandør</Label>
            <Select value={supplier} onValueChange={setSupplier}>
              <SelectTrigger id="fl-ex-supplier" className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Alle leverandører</SelectItem>
                {suppliers.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {q.isError ? <QueryErrorState error={q.error} scope="fakturalesing-eksempler" onRetry={() => void q.refetch()} title="Kunne ikke hente læringseksemplene" />
          : !q.data ? <QueryLoadingState rows={4} />
          : rows.length === 0 ? <QueryEmptyState title="Ingen læringseksempler ennå" description="Eksempler lagres når «Læring av rettinger» er på og noen kobler, retter eller merker en linje." />
          : <ul className="divide-y">{rows.map((r) => <ExampleItem key={r.id} row={r} onChanged={() => q.refetch()} />)}</ul>}
      </CardContent>
    </Card>
  );
}

function ExampleItem({ row, onChanged }: { row: ExampleListRow; onChanged: () => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const changes = exampleChanges(row.original, row.corrected);

  const setActive = async (active: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const { data, error: e } = await supabase.rpc("rm_set_extraction_example_active", { p_example_id: row.id, p_active: active, p_reason: active ? reason.trim() : undefined });
      const ok = !e && data && typeof data === "object" && !Array.isArray(data) && "ok" in data && data.ok === true;
      if (!ok) {
        const m = e?.message ?? "";
        setError(m.startsWith("begrunnelse") ? "Skriv en begrunnelse (minst 3 tegn)." : m.startsWith("uavklart_eksempel") ? "Linjen har uavklarte tall. Rett linjen og lagre et nytt eksempel." : m.startsWith("forbidden") ? "Du har ikke skrivetilgang til fakturaer." : "Utfallet er ukjent. Last inn på nytt og kontroller.");
      } else { setAsking(false); setReason(""); }
      await onChanged();
    } finally { lock.current = false; setBusy(false); }
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{exampleTitle(row.original)}</span>
            <Badge variant="outline">{row.kind ? EXAMPLE_KIND_LABEL[row.kind] ?? row.kind : "Rettet linje"}</Badge>
            {!row.isActive && <Badge variant="secondary">Av</Badge>}
            {row.hasAcceptedIssues && <Badge variant="secondary">Brukes ikke (uavklarte tall)</Badge>}
          </div>
          <p className="text-caption text-muted-foreground">{row.supplierName} · {formatDate(row.createdAt)}{row.note ? ` · ${row.note}` : ""}</p>
          {changes.length > 0 && <p className="text-sm">{changes.join(" · ")}</p>}
        </div>
        {row.isActive
          ? <Button variant="outline" size="sm" className="min-h-[44px]" disabled={busy} onClick={() => void setActive(false)}>Slå av</Button>
          : !asking && <Button variant="outline" size="sm" className="min-h-[44px]" disabled={busy} onClick={() => setAsking(true)}>Slå på</Button>}
      </div>
      {asking && !row.isActive && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1 space-y-1">
            <Label htmlFor={`ex-reason-${row.id}`}>Begrunnelse (kontrollert mot originalen)</Label>
            <Input id={`ex-reason-${row.id}`} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[44px]" />
          </div>
          <Button variant="ghost" className="min-h-[44px]" disabled={busy} onClick={() => { setAsking(false); setReason(""); }}>Avbryt</Button>
          <Button className="min-h-[44px]" disabled={busy || reason.trim().length < 3} onClick={() => void setActive(true)}>Slå på</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
    </li>
  );
}
