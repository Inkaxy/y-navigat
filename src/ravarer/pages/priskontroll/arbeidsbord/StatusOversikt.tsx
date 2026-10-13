import { Link } from "react-router-dom";
import type { WorkGroup } from "@/ravarer/lib/workRpcTypes";
import { cn } from "@/lib/utils";
import { countText, type StatusTile } from "./sporLogic";

/** Kompakt statusoversikt. Hver linje har sin egen enhet; tall som ikke er levert av serveren vises som «ukjent». */
export function StatusOversikt({ tiles, active, onGroup }: { tiles: StatusTile[]; active: WorkGroup; onGroup: (g: WorkGroup) => void }) {
  return (
    <section aria-label="Status" className="grid gap-2 sm:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.id} className="rounded-xl border border-line-subtle bg-card px-3 py-2">
          <h2 className="text-sm font-semibold">{t.title}</h2>
          <p className="text-caption text-ink-secondary">{t.explain}</p>
          <ul className="mt-1 space-y-0.5">
            {t.entries.map((e) => {
              const body = (
                <>
                  <span className="truncate">{e.label}</span>
                  <span className={cn("shrink-0 tabular-nums", e.count === 0 && "text-ink-secondary")}>{countText(e)}</span>
                </>
              );
              const cls = "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-muted/60 sm:min-h-[36px]";
              return (
                <li key={e.label}>
                  {e.group ? (
                    <button type="button" className={cn(cls, active === e.group && "bg-muted font-medium")} aria-pressed={active === e.group} onClick={() => onGroup(e.group!)}>
                      {body}
                    </button>
                  ) : e.href ? (
                    <Link to={e.href} className={cls}>{body}</Link>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
