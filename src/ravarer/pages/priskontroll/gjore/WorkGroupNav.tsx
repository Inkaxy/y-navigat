import { Link, useSearchParams } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WORK_GROUPS, type WorkGroup, type WorkItemsCounts } from "@/ravarer/lib/workRpcTypes";
import { cn } from "@/lib/utils";
import { GROUP_LABELS } from "./logic";

function hrefFor(sp: URLSearchParams, g: WorkGroup): string {
  const n = new URLSearchParams(sp);
  n.delete("valgt");
  if (g === "alle") n.delete("gruppe"); else n.set("gruppe", g);
  return `?${n.toString()}`;
}

/**
 * Gruppenavigasjon for Å gjøre: rolig sidekolonne på bred skjerm, nedtrekk på mobil.
 * Tallene er hele køen (serverens tellere), ikke bare de lastede radene.
 */
export function WorkGroupNav({ active, counts, onPick }: { active: WorkGroup; counts: WorkItemsCounts | undefined; onPick: (g: WorkGroup) => void }) {
  const [sp] = useSearchParams();
  const count = (g: WorkGroup) => (counts ? counts[g] : null);
  return (
    <>
      <nav aria-label="Grupper" className="hidden lg:block">
        <ul className="space-y-0.5">
          {WORK_GROUPS.map((g) => {
            const on = g === active;
            const c = count(g);
            return (
              <li key={g}>
                <Link
                  to={hrefFor(sp, g)}
                  replace
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-ink-secondary transition-colors hover:bg-muted/60 hover:text-foreground",
                    on && "bg-card font-medium text-foreground shadow-sm ring-1 ring-border",
                    g === "fakturaer" && "mt-3",
                  )}
                >
                  <span className="truncate">{GROUP_LABELS[g]}</span>
                  {c != null && <span className={cn("tabular-nums text-caption", c === 0 && "opacity-50")}>{c}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="lg:hidden">
        <Select value={active} onValueChange={(v) => { const g = WORK_GROUPS.find((x) => x === v); if (g) onPick(g); }}>
          <SelectTrigger aria-label="Gruppe"><SelectValue /></SelectTrigger>
          <SelectContent>
            {WORK_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>{GROUP_LABELS[g]}{count(g) != null ? ` (${count(g)})` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
