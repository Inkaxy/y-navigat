// «Nullstill køen» – lukkede linjer og mulige duplikater, med «Åpne igjen» enkeltvis eller samlet.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { paths } from "@/ravarer/lib/paths";
import { useResetUndo } from "@/ravarer/hooks/useQueueReset";
import { fetchRunItems } from "@/ravarer/lib/nullstilling/runItems";
import { CLOSE_REASON_LABEL, isCloseReason, type CloseReason } from "@/ravarer/lib/nullstilling/types";
import { fmtInt, Section } from "./parts";

export type ListView = "lukket" | "duplikater";

export function ResetItemsList({ runId, view, canApprove }: { runId: string; view: ListView; canApprove: boolean }) {
  const [reason, setReason] = useState<CloseReason | "">("");
  const [limit, setLimit] = useState(100);
  const { progress, undo } = useResetUndo(runId);
  const q = useQuery({
    queryKey: ["ravarer", "nullstilling", "items", runId, view],
    queryFn: () => fetchRunItems(runId, view === "duplikater" ? "rule=eq.6&reason_code=eq.mulig_duplikat" : "rule=eq.6&status=eq.ferdig"),
  });
  const rows = useMemo(() => (q.data ?? []).filter((r) => !reason || r.reason_code === reason), [q.data, reason]);
  const reasons = useMemo(() => [...new Set((q.data ?? []).map((r) => r.reason_code).filter((x): x is CloseReason => !!x))], [q.data]);
  const reopenable = rows.filter((r) => r.status === "ferdig" && r.undo_status !== "angret");
  const back = paths.fraFaktura({ nullstilling: 1 });

  return (
    <Section title={view === "duplikater" ? "Mulige duplikater" : "Lukkede linjer («Avsluttet ved nullstilling»)"}
      actions={<Link className="text-body text-primary hover:underline" to={back}>Tilbake til kvitteringen</Link>}>
      {view === "duplikater" && <p className="mb-2 text-body text-ink-secondary">Disse ble ikke opprettet fordi en aktiv vare hos samme leverandør har svært likt navn. Åpne linjen igjen og koble den i Fra faktura › Nye varer.</p>}
      {q.isLoading && <p className="text-body">Laster …</p>}
      {q.isError && <p role="alert" className="text-body text-destructive">Kunne ikke laste listen. <Button variant="ghost" size="sm" onClick={() => void q.refetch()}>Prøv igjen</Button></p>}
      {q.data && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {view === "lukket" && (
              <label className="text-body">Årsak{" "}
                <select className="ml-1 h-9 rounded-md border border-input bg-background px-2" value={reason} onChange={(e) => { const v = e.target.value; setReason(isCloseReason(v) ? v : ""); }}>
                  <option value="">Alle ({fmtInt(q.data.length)})</option>
                  {reasons.map((r) => <option key={r} value={r}>{CLOSE_REASON_LABEL[r]}</option>)}
                </select>
              </label>
            )}
            {canApprove && reopenable.length > 0 && (
              <Button size="sm" variant="outline" disabled={progress.running} onClick={() => void undo([6], reopenable.map((r) => r.id)).then(() => q.refetch())}>
                Åpne alle viste igjen ({fmtInt(reopenable.length)})
              </Button>
            )}
            {(progress.running || progress.done > 0) && <span className="text-caption text-ink-secondary" role="status">{fmtInt(progress.done)} av {fmtInt(progress.total)} · {fmtInt(progress.undone)} åpnet · {fmtInt(progress.notPossible)} kunne ikke{progress.unknown ? ` · ${fmtInt(progress.unknown)} ukjent` : ""}</span>}
          </div>
          {rows.length === 0 ? <p className="text-body text-ink-secondary">Ingen linjer.</p> : (
            <ul className="divide-y divide-border">
              {rows.slice(0, limit).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-body">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{r.payload.title || r.item_key}</span>
                    <span className="block text-caption text-ink-secondary">
                      {r.payload.supplier_name ?? ""}{r.reason_code ? ` · ${CLOSE_REASON_LABEL[r.reason_code]}` : ""}{r.payload.detail ? ` · ${r.payload.detail}` : ""}
                      {r.status !== "ferdig" ? ` · ${r.status === "feilet" ? `feilet: ${r.error ?? "ukjent"}` : r.status}` : ""}{r.undo_status === "angret" ? " · åpnet igjen" : ""}
                    </span>
                  </span>
                  {r.payload.invoice_id && <Link className="text-primary hover:underline" to={paths.faktura(r.payload.invoice_id, { linje: r.line_ids[0], retur: `${back}&vis=${view}` })}>Fakturaen</Link>}
                  {canApprove && r.status === "ferdig" && r.undo_status !== "angret" && (
                    <Button size="sm" variant="ghost" disabled={progress.running} onClick={() => void undo([6], [r.id]).then(() => q.refetch())}>Åpne igjen</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {rows.length > limit && <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + 200)}>Vis flere ({fmtInt(rows.length - limit)} til)</Button>}
        </>
      )}
    </Section>
  );
}
