import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setCaseStatus } from "@/fakturaer/lib/supplierCases";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { paths } from "@/ravarer/lib/paths";

/**
 * Eldre sak / sak uten gyldig grunnlag: ærlig vei videre. Ingen automatisk utfylling,
 * godkjenning eller lovnad om at en ny sak kan opprettes.
 */
export function LegacyRecovery({ invoices }: { invoices: [string, string][] }) {
  return (
    <div className="space-y-1 text-sm" data-testid="legacy-recovery">
      <p>Kontroller originalfakturaene og sakens historikk. Er saken utdatert, kan du avbryte den med begrunnelse nedenfor; er den avklart med leverandøren, merk den som løst.</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {invoices.map(([id, no]) => (
          <li key={id}><Link className="text-primary underline underline-offset-2" to={paths.faktura(id)}>Åpne faktura {no}</Link></li>
        ))}
        <li><a className="text-primary underline underline-offset-2" href="#sak-historikk">Sakens historikk</a></li>
      </ul>
      <p className="text-caption text-ink-secondary">Det finnes ingen automatisk erstatning for en eldre sak. En ny sak krever at linjene fortsatt kan kontrolleres av serveren.</p>
    </div>
  );
}

type Status = "open" | "resolved" | "cancelled";

/**
 * Statusendring via `set_supplier_deviation_case_status` (bare saksstatus; endrer aldri fakturapris
 * eller godkjenning). Krever skriverett og begrunnelse.
 */
export function CaseStatusSection({ id, status, resolutionNote, canWrite, supplierId, invoices }: {
  id: string; status: string; resolutionNote: string | null; canWrite: boolean; supplierId: string; invoices: [string, string][];
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [cancelledNow, setCancelledNow] = useState(false);
  const m = useMutation({
    mutationFn: (v: { id: string; status: Status; note: string }) => setCaseStatus(v.id, v.status, v.note),
    onSuccess: async (_d, v) => {
      invalidateRavarerCounts(qc);
      toast.success("Status lagret");
      setNote("");
      setCancelledNow(v.status === "cancelled");
      await qc.invalidateQueries({ queryKey: ["supplier-case", v.id] });
      void qc.invalidateQueries({ queryKey: ["supplier-cases"] });
      void qc.invalidateQueries({ queryKey: ["supplier-items"] });
      void qc.invalidateQueries({ queryKey: ["invoice-approval-overview"] });
      void qc.invalidateQueries({ queryKey: ["audit-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const run = (s: Status) => m.mutate({ id, status: s, note });
  const noReason = !note.trim();

  return (
    <section className="space-y-2 rounded-lg border border-border p-4">
      {cancelledNow && status === "cancelled" && (
        <div role="status" className="space-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm">
          <p>Saken er avbrutt. Linjene er ikke lenger sperret av en åpen sak.</p>
          <p className="text-ink-secondary">Prisgjennomgangen på fakturaene åpnes ikke på nytt, og det er ikke kontrollert at en ny sak kan opprettes. Gå til originalen for å vurdere linjene.</p>
          <ul className="flex flex-wrap gap-x-3">
            {invoices.map(([iid, no]) => <li key={iid}><Link className="text-primary underline underline-offset-2" to={paths.faktura(iid)}>Faktura {no}</Link></li>)}
          </ul>
        </div>
      )}
      {!canWrite ? (
        <p className="text-sm text-ink-secondary">Du har lesetilgang. Endring av saksstatus krever skrivetilgang til fakturaer.</p>
      ) : (
        <>
          <Label htmlFor={`case-note-${id}`}>Begrunnelse for statusendring</Label>
          <Textarea id={`case-note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} />
          {noReason && <p className="text-caption text-ink-secondary">Begrunnelse er påkrevd.</p>}
          <div className="flex flex-wrap gap-2 [&>button]:min-h-11">
            {status === "open" ? (
              <>
                <Button variant="outline" disabled={m.isPending || noReason} onClick={() => run("resolved")}>Merk som løst</Button>
                <Button variant="ghost" disabled={m.isPending || noReason} onClick={() => run("cancelled")}>Avbryt saken</Button>
              </>
            ) : (
              <Button variant="outline" disabled={m.isPending || noReason} onClick={() => run("open")}>Åpne saken igjen</Button>
            )}
          </div>
          {status === "open" && <p className="text-caption text-ink-secondary">Avbryt bare en sak som er utdatert. Statusendringen endrer ikke fakturapriser eller godkjenning.</p>}
        </>
      )}
      {resolutionNote && <p className="text-sm text-ink-secondary">Siste begrunnelse: {resolutionNote}</p>}
      <span hidden data-supplier={supplierId} />
    </section>
  );
}

/**
 * Linjen ligger allerede i en åpen sak: lenk til saken når den finnes i data brukeren allerede
 * har tilgang til, ellers til leverandørens saksliste. Lukker aldri en annen sak.
 */
export function DuplicateCaseNotice({ openCaseId, supplierId }: { openCaseId: string | null; supplierId: string }) {
  return (
    <div role="alert" className="space-y-1 text-sm" data-testid="duplicate-case">
      <p>En av linjene ligger allerede i en åpen leverandørsak. Ingen ny sak er opprettet.</p>
      {openCaseId
        ? <Link className="text-primary underline underline-offset-2" to={paths.sak(openCaseId)}>Åpne den eksisterende saken</Link>
        : <Link className="text-primary underline underline-offset-2" to={paths.saker({ leverandor: supplierId })}>Se leverandørens saker</Link>}
      <p className="text-caption text-ink-secondary">Er den gamle saken utdatert, kan den avbrytes der med begrunnelse.</p>
    </div>
  );
}
