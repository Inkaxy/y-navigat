import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { FocusNotice } from "@/ravarer/pages/priskontroll/faktura/FocusNotice";
import { HoldOutsideDialog, type HoldOutsideTarget } from "@/fakturaer/components/HoldOutsideDialog";
import type { ExclusionResult } from "@/fakturaer/lib/invoiceExclusion";

/** Syntetisk, nettverksfri forhåndsvisning av «Hold utenfor råvarebehandling» (kreditnota 8050625-lignende). Ingenting lagres. */
export default function HoldUtenforPreview() {
  const [qc] = useState(() => new QueryClient());
  const [target, setTarget] = useState<HoldOutsideTarget | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [mode, setMode] = useState<"ok" | "kost" | "ukjent">("ok");
  const open = () => setTarget({
    invoice: { id: "syntetisk", invoice_number: "TEST-8050625", updated_at: "2026-10-14 05:00:00.123456+00", is_credit_note: true },
    line: { id: "l2", line_number: 2, description: "Idun Combisur Soft sekk 20kg", updated_at: "2026-10-14 05:00:00.654321+00" },
    initialScope: "invoice",
  });
  const simulate = async (): Promise<ExclusionResult> => mode === "ok" ? { kind: "ok", already: false, updatedAt: null, lines: 2 }
    : mode === "kost" ? { kind: "rejected", error: "reversering_kreves", blocked: [{ lineId: "l2", lineNumber: 2, blocker: "kostpris_fort" }] }
    : { kind: "unknown" };
  return (
    <QueryClientProvider client={qc}><MemoryRouter>
      <main className="mx-auto max-w-3xl space-y-4 p-page">
        <p className="text-caption text-ink-secondary">Syntetisk forhåndsvisning – ingen data lagres.</p>
        <label className="flex items-center gap-2 text-sm">Simulert svar
          <select value={mode} onChange={(e) => { const v = e.target.value; if (v === "ok" || v === "kost" || v === "ukjent") setMode(v); }} className="rounded border border-border bg-background p-1">
            <option value="ok">Lagret</option><option value="kost">Ført kostpris (sperret)</option><option value="ukjent">Ukjent utfall</option>
          </select></label>
        <FocusNotice kind="kreditnota" backHref="/forhandsvisning/hold-utenfor" backLabel="Varekort" invoiceNumber="TEST-8050625" isCreditNote
          onCredit={() => undefined} onHoldOutside={open} onShowDocument={() => undefined} />
        {done && <p role="status" className="text-sm">{done}</p>}
        <HoldOutsideDialog target={target} canWrite simulate={simulate} onOpenChange={(v) => { if (!v) setTarget(null); }}
          onDone={(s) => setDone(s === "invoice" ? "Hele kreditnotaen er holdt utenfor (simulert)." : "Linjen er holdt utenfor (simulert).")} />
      </main>
    </MemoryRouter></QueryClientProvider>
  );
}
