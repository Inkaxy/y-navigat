import { CheckCircle2, Loader2 } from "lucide-react";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatNok } from "@/fakturaer/lib/constants";
import { WORK_KIND_LABELS, labelFor } from "@/ravarer/lib/labels";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import { cn } from "@/lib/utils";
import { workEffect } from "@/ravarer/lib/workEffect";
import { kr } from "./logic";

// impact_nok er absolutt størrelse fra serveren — vises uten fortegn.
const unsignedKr = (n: number) => kr(Math.abs(n));
import { detailCause } from "./groupCopy";
import { WorkRowPrice } from "./WorkRowPrice";
import { useWorkItemPlans, type WorkItemPlanLines } from "@/ravarer/hooks/useWorkItemPlans";
import { rowPlanSummary } from "@/fakturaer/lib/reviewPlan";

/** Årsak → neste handling for raden: samme gjennomgangsplan som varekortet når linjegrunnlaget finnes, ellers serverens tekst. */
export function rowCause(it: WorkItem, plan: WorkItemPlanLines | undefined): { cause: string; next: string; readonly: boolean; openLines: number } {
  const fallback = { ...detailCause(it), readonly: false, openLines: it.open_lines };
  if (it.type !== "varekort" || !plan) return fallback;
  const s = rowPlanSummary(plan.lines, plan.openLines, null);
  return s ? { ...s, openLines: plan.openLines ?? it.open_lines } : fallback;
}

function MobileEffect({ it }: { it: WorkItem }) {
  const e = workEffect(it);
  return (
    <p className={cn("text-xs sm:hidden", e.kind === "read" ? "text-warning" : "text-ink-secondary")}>
      {e.label}{e.kind === "verified" ? `: ${unsignedKr(e.value)}` : ""}
    </p>
  );
}

/** Kronevirkning: bare server-verifisert prisavvik vises som beløp. */
export function EffectCell({ it }: { it: WorkItem }) {
  const e = workEffect(it);
  return (
    <div className="hidden w-32 shrink-0 text-right sm:block" title={e.kind === "verified" ? undefined : e.detail}>
      <div className="text-caption text-ink-secondary">{e.label}</div>
      {e.kind === "verified"
        ? <div className="text-sm font-medium tabular-nums">{unsignedKr(e.value)}</div>
        : <div className={cn("text-xs", e.kind === "read" ? "text-warning" : "text-ink-secondary")}>{e.kind === "read" ? "Lesing ukontrollert" : "—"}</div>}
    </div>
  );
}

export function rowSubtitle(it: WorkItem): string {
  if (it.type === "faktura") {
    return [it.supplier_name ?? "Ukjent leverandør", it.last_date ? formatDate(it.last_date) : null, `Fakturabeløp ${formatNok(it.amount)}`].filter(Boolean).join(" · ");
  }
  const lines = `${it.open_lines} ${it.open_lines === 1 ? "linje" : "linjer"} på ${it.open_invoices} ${it.open_invoices === 1 ? "faktura" : "fakturaer"}`;
  return [it.supplier_name ?? "Ukjent leverandør", it.sku ? `varenr ${it.sku}` : null, lines].filter(Boolean).join(" · ");
}

type Props = {
  items: WorkItem[];
  total: number;
  selectedKey: string | null;
  loading: boolean;
  fetchingMore: boolean;
  onSelect: (it: WorkItem) => void;
  onMore?: () => void;
  /** Masseutvalg (varekort på tvers av fakturaer). Avkrysning ligger ved siden av radknappen. */
  checked?: ReadonlySet<string>;
  onToggle?: (it: WorkItem, on: boolean) => void;
  /** Smalt sidepanel (arbeidsbordet med valgt element): stablet rad med fullt navn. Styres av panelet, ikke av skjermbredden. */
  compact?: boolean;
};

/** Kompakt stablet rad: navn over 1–2 linjer, leverandør/dato, årsak → handling én gang, prisvirkning egen linje. */
function CompactRow({ it, rc }: { it: WorkItem; rc: ReturnType<typeof rowCause> }) {
  const meta = labelFor(WORK_KIND_LABELS, it.kind, "Oppgave");
  const e = workEffect(it);
  const sub = [it.supplier_name ?? "Ukjent leverandør", it.last_date ? formatDate(it.last_date) : null].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <StatusPill label={meta.label} tokenVar={meta.tokenVar} />
      <p className="line-clamp-2 break-words text-sm font-medium text-foreground" title={it.title}>{it.title}</p>
      <p className="truncate text-caption text-ink-secondary" title={rowSubtitle(it)}>{sub}</p>
      <p className="text-caption" data-testid="row-plan"><span className="text-ink-secondary">{rc.cause}</span> <span className="font-medium text-primary">→ {rc.next}</span></p>
      {e.kind !== "none" && (
        <p className={`text-caption tabular-nums ${e.kind === "read" ? "text-warning" : "text-ink-secondary"}`}>
          {e.label}{e.kind === "verified" ? `: ${unsignedKr(e.value)}` : ""}
        </p>
      )}
    </div>
  );
}

/** Prioritert liste: varekort og fakturasaker med årsak, neste handling og ærlig kronevirkning. */
export function WorkListView({ items, total, selectedKey, loading, fetchingMore, onSelect, onMore, checked, onToggle, compact = false }: Props) {
  const plans = useWorkItemPlans(items.flatMap((it) => (it.type === "varekort" && it.supplier_id && it.item_key ? [{ supplier_id: it.supplier_id, item_key: it.item_key }] : [])));
  const planFor = (it: WorkItem) => (plans.data && it.supplier_id && it.item_key ? plans.data.get(`${it.supplier_id}|${it.item_key}`) : undefined);
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Laster listen">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center text-sm text-ink-secondary">
        <CheckCircle2 className="h-6 w-6 text-success" aria-hidden />
        Ingenting venter i denne gruppen.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul role="listbox" aria-label="Det som venter" className="divide-y divide-line-subtle overflow-hidden rounded-lg border border-border bg-card">
        {items.map((it) => {
          const meta = labelFor(WORK_KIND_LABELS, it.kind, "Oppgave");
          const active = it.key === selectedKey;
          const rc = rowCause(it, planFor(it));
          return (
            <li key={it.key} role="option" aria-selected={active} className="flex items-stretch">
              {onToggle && (
                <span className="flex items-center pl-3">
                  {it.type === "varekort"
                    ? <Checkbox aria-label={`Velg ${it.title}`} checked={checked?.has(it.key) ?? false} onCheckedChange={(v) => onToggle(it, v === true)} />
                    : <span className="w-4" aria-hidden />}
                </span>
              )}
              <button
                type="button"
                data-key={it.key}
                aria-label={compact ? `${it.title}. ${rowSubtitle(it)}. ${rc.cause}. ${rc.next}` : undefined}
                onClick={() => onSelect(it)}
                className={cn(
                  "relative flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
                  active && "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-primary",
                )}
              >
                {compact ? <CompactRow it={it} rc={rc} /> : <>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusPill label={meta.label} tokenVar={meta.tokenVar} />
                    <span className="truncate text-sm font-medium text-foreground">{it.title}</span>
                  </div>
                  <p className="truncate text-sm text-ink-secondary">{rowSubtitle(it)}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-sm" data-testid="row-plan">
                    <span className="text-ink-secondary">{rc.cause}</span>
                    <span aria-hidden className="text-ink-secondary">·</span>
                    <span className="font-medium text-primary">{rc.next} →</span>
                  </p>
                  <WorkRowPrice it={it} />
                  <MobileEffect it={it} />
                </div>
                <EffectCell it={it} />
                </>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between text-caption text-ink-secondary">
        <span className="tabular-nums">Viser {items.length} av {total} i køen</span>
        {onMore && items.length < total && (
          <Button variant="outline" size="sm" onClick={onMore} disabled={fetchingMore}>
            {fetchingMore && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}Vis flere
          </Button>
        )}
      </div>
    </div>
  );
}
