import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { paths } from "@/ravarer/lib/paths";
import type { PriceMover, WorkSummary } from "@/ravarer/lib/workRpcTypes";
import type { ReadingBanner, ReadingHealth } from "@/ravarer/lib/invoiceReadingHealth";

/** Topp 5 reelle prisendringer (uten mistenkelige), størst endring først. Ren funksjon. */
export function topMovers(items: readonly PriceMover[], n = 5): PriceMover[] {
  return items.filter((m) => !m.suspicious && m.change_pct != null)
    .sort((a, b) => Math.abs(b.change_pct!) - Math.abs(a.change_pct!)).slice(0, n);
}

export function readingText(h: ReadingHealth | undefined, error: boolean, banner: ReadingBanner): { text: string; tone: "ok" | "warn" | "bad" | "muted" } {
  if (error) return { text: "Ukjent – kunne ikke lese status", tone: "muted" };
  if (!h || h.state === "unknown") return { text: "Ukjent", tone: "muted" };
  if (h.state === "ok") return { text: "Virker", tone: "ok" };
  if (banner === "key_ok_waiting") return { text: "Nøkkelen er testet, venter på første lesing", tone: "warn" };
  return { text: "Står stille", tone: "bad" };
}

/** Ukjent er aldri 0. */
const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("nb-NO") : "–");

export type FraFakturaCounts = { newItems: number | null; priceJumps: number | null; unread: number | null; total: number | null; limit: number };

type Tile = { label: string; value: string; unit: string; href: string; tone?: "warning" };

/** Tallene på Oversikt (demo D): hver flis peker til Fra faktura, Varer eller Fakturaer – ingen andre flater. */
export function overviewTiles(c: FraFakturaCounts | null, s: WorkSummary | null, invoiceAccess: boolean): { fra: Tile[]; varer: Tile[]; fakturaer: Tile[] } {
  const dq = s?.data_quality ?? null;
  return {
    fra: invoiceAccess ? [
      { label: "Nye varer", value: n(c?.newItems), unit: "leverandørvarer", href: paths.fraFaktura(), tone: "warning" },
      { label: "Prishopp", value: n(c?.priceJumps), unit: `over ${c?.limit ?? 20} %`, href: paths.fraFaktura({ fane: "prishopp" }), tone: "warning" },
      { label: "Ikke lest", value: n(c?.unread), unit: "fakturaer", href: paths.fraFaktura({ fane: "ikke-lest" }), tone: "warning" },
    ] : [],
    varer: [
      { label: "Pakning mangler", value: n(dq ? dq.missing_package + dq.unconfirmed_package : null), unit: "varer", href: paths.pakninger() },
      { label: "Deklarasjon mangler", value: n(dq?.missing_declaration), unit: "varer", href: paths.deklarasjonsnavn() },
      { label: "Næring mangler", value: n(dq?.missing_nutrition), unit: "varer", href: paths.naering() },
    ],
    fakturaer: invoiceAccess ? [
      { label: "Til godkjenning", value: n(s?.approval?.ready_to_approve), unit: "fakturaer", href: paths.godkjenning() },
      { label: "Alle fakturaer", value: "", unit: "arkivet", href: paths.alleFakturaer() },
    ] : [],
  };
}

function TileGrid({ title, tiles }: { title: string; tiles: Tile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">{title}</h3>
      <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="bg-card">
            <Link to={t.href} className="flex min-h-[64px] flex-col justify-center px-3 py-2 hover:bg-muted/50">
              <dt className="text-caption text-ink-secondary">{t.label}</dt>
              <dd className={cn("text-lg font-semibold tabular-nums", t.tone === "warning" && t.value !== "0" && t.value !== "–" && "text-warning")}>
                {t.value} <span className="text-caption font-normal text-ink-secondary">{t.unit}</span>
              </dd>
            </Link>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Råvarer › Oversikt (opprydding demo D): Fra faktura-kortet, fakturalesing, største prisendringer og tall til Varer/Fakturaer. */
export function FraFakturaOverviewCard({ counts, summary, invoiceAccess, health, healthError, banner, movers, moversError, period }: {
  counts: FraFakturaCounts | null; summary: WorkSummary | null; invoiceAccess: boolean;
  health: ReadingHealth | undefined; healthError: boolean; banner: ReadingBanner;
  movers: PriceMover[] | null; moversError: boolean; period: number;
}) {
  const tiles = overviewTiles(counts, summary, invoiceAccess);
  const reading = readingText(health, healthError, banner);
  const top = movers ? topMovers(movers) : null;
  return (
    <section aria-labelledby="fra-faktura-oversikt" className="space-y-5 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="fra-faktura-oversikt" className="font-serif text-title">Fra faktura til vare</h2>
          <p className="text-body text-ink-secondary">
            {!invoiceAccess ? "Du har ikke tilgang til fakturaer." : counts?.total == null ? "Antallet er ukjent akkurat nå." : counts.total === 0 ? "Ingenting venter på deg." : `${n(counts.total)} ting venter på deg, eldste først.`}
          </p>
        </div>
        {invoiceAccess && (
          <Button asChild size="lg" className="min-h-[44px] gap-1.5"><Link to={paths.fraFaktura()}>Åpne Fra faktura<ArrowRight className="h-4 w-4" aria-hidden /></Link></Button>
        )}
      </div>
      <TileGrid title="Fra faktura" tiles={tiles.fra} />
      <div className="grid gap-5 md:grid-cols-2">
        <TileGrid title="Varer" tiles={tiles.varer} />
        <TileGrid title="Fakturaer" tiles={tiles.fakturaer} />
      </div>
      <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
        {invoiceAccess && (
          <div className="space-y-1">
            <p className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">Fakturalesing</p>
            <p className={cn("text-base font-semibold", reading.tone === "ok" && "text-success", reading.tone === "bad" && "text-destructive",
              reading.tone === "warn" && "text-warning", reading.tone === "muted" && "text-ink-secondary")}>{reading.text}</p>
            {health?.state === "failing" && health.waitingInvoices ? <p className="text-caption text-ink-secondary">{health.waitingInvoices.toLocaleString("nb-NO")} faktura(er) venter på lesing.</p> : null}
          </div>
        )}
        <div className="space-y-1">
          <p className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-secondary">Største prisendringer siste {period} dager</p>
          {moversError ? <p className="text-sm text-ink-secondary">Kunne ikke hente prisendringer.</p>
            : top == null ? <p className="text-sm text-ink-secondary">…</p>
            : top.length === 0 ? <p className="text-sm text-ink-secondary">Ingen sikre prisendringer i perioden.</p>
            : (
              <ul className="space-y-1 text-sm">
                {top.map((m) => (
                  <li key={`${m.raw_material_id}:${m.supplier_id ?? ""}`}>
                    <Link to={paths.raavare(m.raw_material_id, { seksjon: "pris" })} className="flex min-h-[32px] items-center justify-between gap-2 hover:underline">
                      <span className="truncate">{m.rm_name}</span>
                      <span className={cn("tabular-nums font-medium", (m.change_pct ?? 0) > 0 ? "text-destructive" : "text-success")}>
                        {(m.change_pct ?? 0) > 0 ? "+" : ""}{(m.change_pct ?? 0).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </section>
  );
}
