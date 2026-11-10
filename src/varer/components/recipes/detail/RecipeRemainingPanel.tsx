import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Loader2, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { RemainingItem, RemainingSummary } from "@/varer/lib/recipeRemaining";
import { RECIPE_TABS } from "@/varer/lib/recipeTabs";

export interface RemainingSource {
  key: string;
  label: string;
  state: "loading" | "error" | "ready";
  retry?: () => void;
}

const TAB_LABEL = Object.fromEntries(RECIPE_TABS.map((t) => [t.id, t.label])) as Record<string, string>;

/**
 * «Gjenstår»: én liste i to grupper. Hvert punkt er en knapp som bytter fane
 * og flytter fokus. En kilde som laster eller feiler vises for seg — en tom
 * liste betyr bare «ferdig» når alle kilder faktisk er hentet.
 */
export function RecipeRemainingPanel({
  summary,
  sources,
  onSelect,
  collapsible,
}: {
  summary: RemainingSummary;
  sources: RemainingSource[];
  onSelect: (item: RemainingItem) => void;
  /** Smal skjerm: listen kan foldes sammen. */
  collapsible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pending = sources.filter((s) => s.state === "loading");
  const failed = sources.filter((s) => s.state === "error");
  const allKnown = pending.length === 0 && failed.length === 0;
  const mustCount = summary.must.length;
  const shouldCount = summary.should.length;
  const expanded = !collapsible || open;

  const headline = mustCount > 0
    ? `${mustCount} må rettes`
    : allKnown
      ? "Alt påkrevd er på plass"
      : "Kontrollerer …";

  return (
    <section aria-labelledby="gjenstar-tittel" className="rounded-md border border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h2 id="gjenstar-tittel" className="font-display text-title text-foreground">Gjenstår</h2>
        {collapsible && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-[44px] gap-1"
            aria-expanded={open}
            aria-controls="gjenstar-liste"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Skjul" : "Vis"}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        )}
      </div>
      <p className={cn("px-4 pb-2 text-body", mustCount > 0 ? "text-destructive" : allKnown ? "text-success" : "text-muted-foreground")}>
        {headline}
        {shouldCount > 0 && <span className="text-muted-foreground"> · {shouldCount} bør sjekkes</span>}
      </p>

      {expanded && (
        <div id="gjenstar-liste" className="space-y-3 px-2 pb-3">
          {pending.length > 0 && (
            <p className="flex items-center gap-2 px-2 text-caption text-muted-foreground" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Henter {pending.map((s) => s.label).join(", ")} …
            </p>
          )}
          {failed.map((s) => (
            <div key={s.key} role="alert" className="mx-2 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-caption">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span className="flex-1">Kunne ikke hente {s.label}. Listen kan være ufullstendig.</span>
              {s.retry && (
                <Button size="sm" variant="outline" className="min-h-[44px]" onClick={s.retry}>Prøv igjen</Button>
              )}
            </div>
          ))}

          {mustCount > 0 && (
            <ItemGroup title="Må rettes før godkjenning" items={summary.must} onSelect={onSelect} />
          )}
          {allKnown && mustCount === 0 && (
            <p className="flex items-center gap-2 px-2 text-body text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Alt påkrevd er på plass
            </p>
          )}
          {shouldCount > 0 && (
            <ItemGroup title="Bør sjekkes" items={summary.should} onSelect={onSelect} />
          )}
        </div>
      )}
    </section>
  );
}

function ItemGroup({ title, items, onSelect }: { title: string; items: RemainingItem[]; onSelect: (i: RemainingItem) => void }) {
  return (
    <div>
      <h3 className="px-2 pb-1 text-caption font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <RemainingRow item={item} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RemainingRow({ item, onSelect }: { item: RemainingItem; onSelect: (i: RemainingItem) => void }) {
  const Icon = item.severity === "must" ? XCircle : AlertTriangle;
  const shown = item.details.slice(0, 3);
  const more = item.details.length - shown.length;
  return (
    <div className="rounded-md hover:bg-muted/50">
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="flex min-h-[44px] w-full items-start gap-2 rounded-md px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon
          className={cn("mt-0.5 h-4 w-4 shrink-0", item.severity === "must" ? "text-destructive" : "text-warning")}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-body text-foreground">{item.title}</span>
          {shown.map((d, i) => (
            <span key={i} className="block text-caption text-muted-foreground">{d}</span>
          ))}
          {more > 0 && <span className="block text-caption text-muted-foreground">+ {more} til</span>}
          <span className="block text-caption text-muted-foreground">Gå til {TAB_LABEL[item.tab]}</span>
        </span>
      </button>
      {item.action && (
        <Link
          to={item.action.href}
          className="ml-8 inline-flex min-h-[44px] items-center gap-1 px-2 text-caption text-app underline underline-offset-2"
        >
          {item.action.label}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
