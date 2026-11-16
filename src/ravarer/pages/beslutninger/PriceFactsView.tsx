import { StatusPill } from "@/ordre/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { dateNo, kr, pct } from "@/ravarer/lib/decisions";
import { previousText, type PriceFacts, type PurchaseStatus } from "@/ravarer/lib/decisionFacts";
import type { SupplierItem } from "@/fakturaer/lib/supplierItems";

const STATUS: Record<PurchaseStatus, { label: string; tone: string } | null> = {
  godkjent: { label: "Godkjent", tone: "--state-success" },
  na: { label: "Denne avgjør du nå", tone: "--state-warning" },
  apen: { label: "Åpen", tone: "--state-neutral" },
  ukjent: null,
};

/** Regnestykket, kjøp i datorekkefølge og «Det systemet vet». Bare visning. */
export function PriceFactsView({ facts, item }: { facts: PriceFacts; item: SupplierItem | null }) {
  const bu = facts.baseUnit;
  const per = bu ? `/${bu}` : "";
  return (
    <div className="space-y-4">
      {facts.arithmetic.length > 0 && (
        <section aria-label="Regnestykket" className="rounded-xl bg-muted/60 p-3">
          <h3 className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">Regnestykket</h3>
          {facts.arithmetic.map((l) => <p key={l} className="text-body tabular-nums">{l}</p>)}
        </section>
      )}
      {facts.purchases.length > 0 && (
        <section aria-label="Kjøp i datorekkefølge">
          <h3 className="mb-1 text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">Kjøp i datorekkefølge, eldste først</h3>
          <ul className="divide-y divide-line-subtle border-y border-line-subtle">
            {facts.purchases.map((p) => {
              const s = STATUS[p.status];
              return (
                <li key={p.lineId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <span className="w-24 tabular-nums text-ink-secondary">{dateNo(p.date)}</span>
                  <span className="w-32 font-semibold tabular-nums">{kr(p.price)}{per}</span>
                  <span className={cn("w-20 tabular-nums", p.changePct != null && p.changePct > 0 ? "text-destructive" : "text-ink-secondary")}>
                    {p.changePct == null ? "" : `${p.changePct > 0 ? "+" : "−"}${pct(Math.abs(p.changePct))}`}
                  </span>
                  {s && <StatusPill label={s.label} tokenVar={s.tone} hideDot />}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section aria-label="Det systemet vet">
        <h3 className="mb-1 text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">Det systemet vet</h3>
        <dl className="divide-y divide-line-subtle border-y border-line-subtle text-body">
          <Fact k="Sammenlignet med" v={previousText(facts.previous, bu)} />
          <Fact k="Avtale" v={facts.current?.price_reference_source === "agreement" ? "Avtalepris er brukt som sammenligning" : "Ingen avtale brukt i sammenligningen"} />
          <Fact k="Pakning" v={facts.current?.package_size != null
            ? `${facts.current.package_size.toLocaleString("nb-NO")} ${facts.current.package_unit ?? ""}${item?.package_confirmed ? ", bekreftet" : ", ikke bekreftet"}`
            : "Ukjent"} />
          <Fact k="Merkostnad" v={merText(facts)} />
        </dl>
      </section>
    </div>
  );
}

function merText(f: PriceFacts): string {
  if (f.openExtraNok == null && f.monthlyExtraNok == null) return "Kan ikke beregnes ennå";
  const parts: string[] = [];
  if (f.openExtraNok != null) parts.push(`${kr(Math.round(f.openExtraNok))} på fakturaene du svarer på`);
  if (f.monthlyExtraNok != null) parts.push(`rundt ${kr(f.monthlyExtraNok)} per måned ved dagens forbruk`);
  return parts.join(", ");
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[12rem_1fr]">
      <dt className="text-ink-secondary">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
