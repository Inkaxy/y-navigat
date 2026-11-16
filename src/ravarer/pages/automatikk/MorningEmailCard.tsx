import { Mail } from "lucide-react";
import { morningEmail, type AutoLogCounts } from "@/ravarer/lib/automatikk";
import type { Decision } from "@/ravarer/lib/decisions";

/** Forhåndsvisning av morgen-e-posten, bygget fra køen nå. Selve utsendingen er ikke bygget. */
export function MorningEmailCard({ log, openCount, decisions }: { log: AutoLogCounts | undefined; openCount: number | null; decisions: Decision[] | null }) {
  const oldest = decisions?.[0] ?? null;
  const biggest = (decisions ?? []).filter((d) => d.impactNok != null).sort((a, b) => Math.abs(b.impactNok ?? 0) - Math.abs(a.impactNok ?? 0))[0] ?? null;
  const lines = morningEmail({
    name: "Henrik",
    log: log ?? { newInvoices: null, linesLinked: null, linesExcluded: null, invoicesReconciled: null, recalculated: null },
    openQuestions: openCount,
    oldest: oldest ? { question: oldest.question, date: oldest.oldestDate } : null,
    biggest: biggest && biggest.impactNok != null ? { text: biggest.question, impactNok: biggest.impactNok } : null,
  });
  return (
    <section aria-labelledby="epost-tittel" className="space-y-2 rounded-2xl border border-line-subtle bg-card p-4">
      <h2 id="epost-tittel" className="flex items-center gap-2 text-body font-semibold"><Mail className="h-4 w-4" aria-hidden />E-posten du får kl. 07.00</h2>
      <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>
      <p className="text-caption text-ink-secondary">Forhåndsvisning bygget fra køen nå. Utsendingen er ikke slått på ennå – den bygges i et senere trinn.</p>
    </section>
  );
}
