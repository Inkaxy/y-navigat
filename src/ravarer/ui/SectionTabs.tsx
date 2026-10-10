import { useRef, type KeyboardEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { activeTabFrom, nextTabSearch, stepTab } from "@/ravarer/ui/sectionTabsLogic";

export type TabTone = "default" | "warning" | "danger";
export type SectionTab = {
  id: string;
  label: string;
  count?: number | null;
  tone?: TabTone;
  /** Lenkefane (aktiv etter sti) i stedet for query-fane. */
  href?: string;
  hidden?: boolean;
};

const TONE: Record<TabTone, string> = {
  default: "bg-muted text-muted-foreground",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
};

export function TabCount({ count, tone = "default" }: { count?: number | null; tone?: TabTone }) {
  if (count == null || count <= 0) return null;
  return <span className={cn("ml-1.5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums", TONE[tone])}>{count}</span>;
}

type Props = {
  tabs: SectionTab[];
  /** Query-parameteren som holder fanen (standard «fane»). */
  param?: string;
  /** Standardfane — skrives ikke i URL-en. */
  defaultTab?: string;
  /** Parametre som tilhører en fane og skal fjernes ved bytte. */
  clearParams?: string[];
  ariaLabel: string;
  /** Aktiv fane for lenkefaner (ellers fra URL). */
  activeId?: string;
};

/** URL-styrte faner med tellerpille, piltaster og horisontal scroll på mobil. */
export function SectionTabs({ tabs, param = "fane", defaultTab, clearParams, ariaLabel, activeId }: Props) {
  const [sp] = useSearchParams();
  const { pathname } = useLocation();
  const visible = tabs.filter((t) => !t.hidden);
  const ids = visible.map((t) => t.id);
  const fallback = defaultTab ?? ids[0];
  const active = activeId ?? activeTabFrom(sp, param, ids, fallback);
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});

  const hrefFor = (t: SectionTab) =>
    t.href ?? `${pathname}?${nextTabSearch(sp, param, t.id, { fallback, clear: clearParams }).toString()}`.replace(/\?$/, "");

  const onKey = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = stepTab(ids, active, e.key === "ArrowRight" ? 1 : -1);
    refs.current[next]?.focus();
    refs.current[next]?.click();
  };

  return (
    <nav aria-label={ariaLabel} className="-mx-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div role="tablist" className="flex min-w-max gap-1 border-b border-border px-1">
        {visible.map((t) => {
          const on = t.id === active;
          return (
            <Link
              key={t.id}
              ref={(el) => { refs.current[t.id] = el; }}
              to={hrefFor(t)}
              replace={!t.href}
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onKeyDown={onKey}
              className={cn(
                "-mb-px inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors",
                on ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <TabCount count={t.count} tone={t.tone} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
