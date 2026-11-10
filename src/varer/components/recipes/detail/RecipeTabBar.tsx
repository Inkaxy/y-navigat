import { useRef, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { RECIPE_TABS, type RecipeTabId } from "@/varer/lib/recipeTabs";

export interface TabIndicator {
  must: number;
  should: number;
  /** Alle kilder for fanen er hentet. Uten dette vises verken tall eller hake. */
  known: boolean;
}

/**
 * Fanene på oppskriftssiden. Knapper, ikke lenker: et fanebytte er ikke en
 * navigasjon og skal ikke utløse vakten for ulagrede endringer.
 */
export function RecipeTabBar({
  active,
  onChange,
  indicators,
}: {
  active: RecipeTabId;
  onChange: (tab: RecipeTabId) => void;
  indicators: Partial<Record<RecipeTabId, TabIndicator>>;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const idx = RECIPE_TABS.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % RECIPE_TABS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + RECIPE_TABS.length) % RECIPE_TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = RECIPE_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = RECIPE_TABS[next].id;
    onChange(id);
    refs.current[id]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Deler av oppskriften"
      onKeyDown={onKeyDown}
      className="relative -mx-1 flex gap-1 overflow-x-auto border-b border-line-subtle px-1"
    >
      {RECIPE_TABS.map((t) => {
        const selected = t.id === active;
        const ind = indicators[t.id];
        const count = ind?.known ? (ind.must > 0 ? ind.must : ind.should) : 0;
        const tone = ind?.known ? (ind.must > 0 ? "must" : ind.should > 0 ? "should" : "done") : null;
        const srText =
          tone === "must"
            ? `, ${ind!.must} må rettes`
            : tone === "should"
              ? `, ${ind!.should} bør sjekkes`
              : tone === "done"
                ? ", ferdig"
                : "";
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`oppskrift-fane-${t.id}`}
            aria-selected={selected}
            aria-controls={`oppskrift-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px inline-flex min-h-[44px] shrink-0 items-center gap-2 border-b-2 px-3 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-app text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{t.label}</span>
            {tone === "must" || tone === "should" ? (
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-caption font-semibold tabular-nums",
                  tone === "must" ? "bg-destructive text-destructive-foreground" : "bg-warning/20 text-warning",
                )}
              >
                {count}
              </span>
            ) : tone === "done" ? (
              <Check aria-hidden="true" className="h-4 w-4 text-success" />
            ) : null}
            {srText && <span className="sr-only">{srText}</span>}
          </button>
        );
      })}
    </div>
  );
}
