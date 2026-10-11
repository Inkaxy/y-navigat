// Kun dev-server: ekte RereadView-komponenter med faste data. Ingen nettverk, ingen lagring.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PdfDocumentViewer } from "@/fakturaer/components/PdfDocumentViewer";
import { RereadView, ReadingState } from "@/fakturaer/components/reread/RereadView";
import { parseRun, rereadErrorText, type PendingApply } from "@/fakturaer/lib/reread";
import { rereadFixtureRow } from "./rereadFixtures";
import samplePdf from "./sample-credit-note.pdf?url";
import "@/index.css";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
const s = new URLSearchParams(window.location.search).get("s") ?? "ready";
const run = parseRun(rereadFixtureRow(s === "failed" ? "failed" : s === "reading" ? "reading" : "ready"));

function App() {
  const [applied, setApplied] = useState<string | null>(null);
  const pending: PendingApply | null = s === "pending" ? { runId: run.id, reason: "Kontrollert mot originalen", operations: [{ kind: "add", candidate_id: "line-3", changes: run.candidates[3].values, confirmed_addition: true }] } : null;
  const doc = <PdfDocumentViewer url={samplePdf} cacheKey="dev/reread.pdf" title="Original" fallback={<span>Åpne originalen</span>} />;
  return (
    <div className="space-y-4 px-page py-4">
      <h1 className="font-serif text-xl">Les originalen på nytt (faste data: {s})</h1>
      {s === "reading" && <ReadingState startedAt={new Date(Date.now() - 3 * 60_000).toISOString()} invoked invoking={false} invokeCode="ukjent_utfall" canAct busy={false} onInvoke={() => undefined} onRefresh={() => undefined} onCancel={() => undefined} />}
      {s === "failed" && <p role="status" className="rounded-lg border border-border p-4 text-sm">Lesingen feilet: {rereadErrorText(run.error_code)}</p>}
      {(s === "ready" || s === "pending" || s === "other") && (
        <RereadView run={run} document={doc} canApply={s !== "other"} readOnlyReason={s === "other" ? "Lesingen ble startet av en annen bruker. Du kan se den, men ikke ta den i bruk." : null}
          pending={pending} saving={false} applyMessage={applied} onApply={(ops) => setApplied(`(faste data) ${ops.length} valg ville blitt sendt — ingenting er lagret.`)} onRetryPending={() => setApplied("(faste data) samme forespørsel ville blitt sendt på nytt.")} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={qc}><TooltipProvider><App /></TooltipProvider></QueryClientProvider>);
