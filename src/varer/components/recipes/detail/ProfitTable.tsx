import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, ExternalLink, Loader2, MinusCircle, Star, Trash2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RecipeProductLinkRow } from "@/varer/hooks/useRecipeProductLinks";
import { PRICE_LEVEL_LABEL, PRICE_LEVEL_ORDER, type MarginLevel, type PriceLevel, type ProductMargins } from "@/varer/hooks/useProductCalc";
import { nKr, nPct } from "@/varer/lib/calcFormat";
import { marginStatusMeta, type MarginTone } from "@/varer/lib/marginStatus";
import { perKg, salesUnitWeight, SALES_UNIT_WEIGHT_SOURCE_LABEL, type SalesUnitWeight } from "@/varer/lib/salesUnitPrice";
import { ProfitRowDetails } from "./ProfitRowDetails";

export interface ProfitRow {
  link: RecipeProductLinkRow;
  state: "loading" | "error" | "ready";
  margins: ProductMargins | undefined;
  retry: () => void;
}

const GRID = "lg:grid lg:grid-cols-[minmax(12rem,1.3fr)_minmax(8rem,1fr)_repeat(3,minmax(8rem,1fr))] lg:gap-x-3";

/** Én rad per koblet vare, én kolonne per prisnivå. Tallene er fra `product_margins`. */
export function ProfitTable({
  rows,
  currentProductId,
  canWrite,
  busy,
  onUnlink,
}: {
  rows: ProfitRow[];
  currentProductId: string | null;
  canWrite: boolean;
  busy: boolean;
  onUnlink: (link: { id: string; name: string }) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card">
      <div className={cn("hidden border-b border-border px-3 py-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground", GRID)}>
        <span>Vare</span>
        <span>Kost per enhet</span>
        {PRICE_LEVEL_ORDER.map((l) => <span key={l}>{PRICE_LEVEL_LABEL[l]}</span>)}
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.link.id} id={`vare-${r.link.product_id}`} className="scroll-mt-28">
            <ProductRow row={r} isCurrent={r.link.product_id === currentProductId} canWrite={canWrite} busy={busy} onUnlink={onUnlink} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProductRow({ row, isCurrent, canWrite, busy, onUnlink }: {
  row: ProfitRow; isCurrent: boolean; canWrite: boolean; busy: boolean;
  onUnlink: (link: { id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const { link, margins } = row;
  const p = link.products;
  const name = p?.display_name ?? "Uten navn";
  const extraCount = Array.isArray(link.extra_lines) ? link.extra_lines.length : 0;
  const weight = salesUnitWeight(link, p);
  const detailsId = `vare-detaljer-${link.id}`;

  return (
    <div className="px-3 py-3">
      <div className={cn("space-y-3 lg:space-y-0", GRID)}>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to={`/varer/vareliste/${link.product_id}?tab=deklarasjon`}
              className="inline-flex min-h-[44px] items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline lg:min-h-0"
              title="Åpne deklarasjon for dette produktet"
            >
              {name}
              <ExternalLink className="h-3 w-3 opacity-60" aria-hidden="true" />
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
            {p?.display_number != null && <span className="font-mono">#{p.display_number}</span>}
            {p?.unit_of_sale && <span>· {p.unit_of_sale}</span>}
            {link.is_primary && (
              <Badge variant="outline" className="gap-1 border-app/50 text-app"><Star className="h-3 w-3" aria-hidden="true" /> Primær</Badge>
            )}
            <Badge variant="outline">{link.declaration_mode === "manual" ? "Overstyrt" : "Arvet"}</Badge>
            {extraCount > 0 && <Badge variant="outline">+{extraCount} tillegg</Badge>}
            {isCurrent && <Badge variant="secondary">Denne varen</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" className="min-h-[44px] gap-1 px-2" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((v) => !v)}>
              <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
              {open ? "Skjul detaljer" : "Vis detaljer"}
            </Button>
            {canWrite && !isCurrent && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-[44px] gap-1 px-2 text-muted-foreground hover:text-destructive"
                disabled={busy}
                aria-label={`Koble fra ${name}`}
                onClick={() => onUnlink({ id: link.id, name })}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Koble fra
              </Button>
            )}
          </div>
        </div>

        {row.state === "loading" ? (
          <p className="flex items-center gap-2 text-caption text-muted-foreground lg:col-span-4" aria-live="polite">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Henter kalkyle …
          </p>
        ) : row.state === "error" ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-caption text-destructive lg:col-span-4">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Kunne ikke hente kalkylen. Tallene er ukjente.
            <Button size="sm" variant="outline" className="min-h-[44px]" onClick={row.retry}>Prøv igjen</Button>
          </div>
        ) : !margins?.has_cost ? (
          <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-caption lg:col-span-4">
            <p className="font-medium text-foreground">Mangler kalkyle — Brutto og DG2 kan ikke regnes ut</p>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {((margins?.cost?.notes ?? []).filter((n) => n.trim()).length > 0
                ? (margins?.cost?.notes ?? []).filter((n) => n.trim())
                : ["Kalkylen har ikke fullstendig grunnlag."]
              ).map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </div>
        ) : (
          <>
            <CostCell margins={margins} weight={weight} />
            {PRICE_LEVEL_ORDER.map((level) => (
              <LevelCell
                key={level}
                level={level}
                entries={(margins.levels ?? []).filter((l) => l.price_level === level)}
                weight={weight}
                halvfabrikat={margins.calc_type === "halvfabrikat"}
              />
            ))}
          </>
        )}
      </div>
      {open && (
        <div id={detailsId} className="mt-3">
          <ProfitRowDetails state={row.state} margins={margins} weight={weight} />
        </div>
      )}
    </div>
  );
}

function CostCell({ margins, weight }: { margins: ProductMargins; weight: SalesUnitWeight }) {
  const c = margins.cost;
  const selfKg = perKg(c?.cost_price ?? null, weight.grams);
  return (
    <div className="space-y-0.5 text-caption">
      <div className="text-muted-foreground lg:hidden">Kost per enhet</div>
      <div><span className="text-muted-foreground">Råvare </span><span className="tabular-nums">{nKr(c?.raw_cost)}</span></div>
      <div><span className="text-muted-foreground">Selvkost </span><span className="font-semibold tabular-nums">{nKr(c?.cost_price)}</span></div>
      <div title={weight.reason ?? (weight.source ? `Vekt ${SALES_UNIT_WEIGHT_SOURCE_LABEL[weight.source]}` : undefined)}>
        <span className="text-muted-foreground">Selvkost/kg </span>
        <span className="tabular-nums">{selfKg != null ? nKr(selfKg) : "–"}</span>
      </div>
    </div>
  );
}

const TONE_CLASS: Record<MarginTone, string> = {
  ok: "border-success/40 bg-success/10 text-success",
  warn: "border-warning/40 bg-warning/10 text-warning",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
};
const TONE_ICON = { ok: CheckCircle2, warn: AlertTriangle, bad: XCircle, neutral: MinusCircle } as const;

export function MarginStatusBadge({ status }: { status: string | null | undefined }) {
  const meta = marginStatusMeta(status);
  const Icon = status ? TONE_ICON[meta.tone] : CircleHelp;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium", TONE_CLASS[meta.tone])}>
      <Icon className="h-3 w-3" aria-hidden="true" /> {meta.label}
    </span>
  );
}

function LevelCell({ level, entries, weight, halvfabrikat }: {
  level: PriceLevel; entries: MarginLevel[]; weight: SalesUnitWeight; halvfabrikat: boolean;
}) {
  return (
    <div className="space-y-2 text-caption">
      <div className="text-muted-foreground lg:hidden">{PRICE_LEVEL_LABEL[level]}</div>
      {entries.length === 0 ? (
        <span className="text-muted-foreground">{halvfabrikat ? "Halvfabrikat — ingen salgspris" : "Ingen prisliste"}</span>
      ) : (
        entries.map((e) => <LevelEntry key={e.price_list_id} entry={e} weight={weight} showName={entries.length > 1} />)
      )}
    </div>
  );
}

function LevelEntry({ entry, weight, showName }: { entry: MarginLevel; weight: SalesUnitWeight; showName: boolean }) {
  const kg = perKg(entry.price, weight.grams);
  return (
    <div className="space-y-0.5">
      {showName && entry.name && <div className="font-medium text-foreground">{entry.name}</div>}
      <div className="font-semibold tabular-nums">{entry.price != null ? nKr(entry.price) : "Ingen pris"}</div>
      <div className="tabular-nums text-muted-foreground" title={kg == null && entry.price != null ? weight.reason ?? undefined : undefined}>
        {kg != null ? `${nKr(kg)}/kg` : "– /kg"}
      </div>
      <div className="tabular-nums">
        Brutto {nPct(entry.brutto_pct)}
        {entry.target_brutto_pct != null && <span className="text-muted-foreground"> · mål {nPct(entry.target_brutto_pct, 0)}</span>}
      </div>
      <div className="tabular-nums">
        DG2 {nPct(entry.dg2_pct)}
        {entry.target_dg2_pct != null && <span className="text-muted-foreground"> · mål {nPct(entry.target_dg2_pct, 0)}</span>}
      </div>
      <MarginStatusBadge status={entry.status} />
    </div>
  );
}
