import { useMemo, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { QueryState } from "@/components/common/QueryState";
import { useUiPreference } from "@/hooks/useUiPreference";
import { cn } from "@/lib/utils";
import { INTERACTIVE_SELECTOR, sortRows, stepRow, toggleSelection, visibleColumns, type SortDir, type SortValue } from "@/ravarer/ui/dataTableLogic";
import { useHotkeys } from "@/ravarer/ui/hotkeys";

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortKey?: (row: T) => SortValue;
  align?: "left" | "right" | "center";
  width?: string;
  hideable?: boolean;
  defaultHidden?: boolean;
  /** Kan aldri skjules (f.eks. navn). */
  alwaysVisible?: boolean;
  /** CSV-verdi. Eksport bruker samme kolonneliste og rekkefølge som tabellen. */
  csv?: (row: T) => string;
  /** Overskriftens visningsnavn i kolonnevelgeren hvis forskjellig. */
  menuLabel?: string;
};

type Props<T> = {
  rows: T[] | undefined;
  columns: Column<T>[];
  getId: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyText?: string;
  /** Lagre kolonnevalg per bruker. */
  preferenceScope?: string;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  activeId?: string | null;
  onActiveChange?: (id: string | null) => void;
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  renderMobileCard?: (row: T) => ReactNode;
  footer?: ReactNode;
  hotkeys?: boolean;
  /**
   * Styrt sortering: radene er allerede sortert av kalleren (f.eks. på serveren
   * eller over hele listen før sideinndeling). DataTable sorterer da ikke selv.
   */
  sort?: { id: string; dir: SortDir } | null;
  onSortChange?: (s: { id: string; dir: SortDir } | null) => void;
  ariaLabel: string;
  /** Styrte skjulte kolonner (f.eks. migrert brukerpreferanse). Overstyrer `preferenceScope`. */
  hidden?: readonly string[];
  onHiddenChange?: (hidden: string[]) => void;
  /** Vis kolonnevelgeren (standard: når kolonnevalg er lagret/styrt). */
  columnMenu?: boolean;
  /** Enter på aktiv rad (standard: samme som radklikk). */
  onEnter?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  /** Ekstra klasser på tabellens rullekasse (høydetak o.l.). */
  scrollClassName?: string;
  minTableWidth?: string;
  emptyDescription?: string;
  /** Tette rader: celler brytes ikke (kolonner styrer egen bredde/avkorting); tabellen ruller vannrett. */
  dense?: boolean;
};

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function DataTable<T>(p: Props<T>) {
  const navigate = useNavigate();
  const [localSort, setLocalSort] = useState<{ id: string; dir: SortDir } | null>(null);
  const controlled = !!p.onSortChange;
  const sort = controlled ? p.sort ?? null : localSort;
  const anchor = useRef<string | null>(null);
  const defaultHidden = useMemo(() => p.columns.filter((c) => c.defaultHidden).map((c) => c.id), [p.columns]);
  const { value: hiddenPref, setValue: setHiddenPref } = useUiPreference<string[]>(p.preferenceScope ?? "ravarer:datatable:ephemeral", defaultHidden);
  const hiddenList = p.hidden ?? (p.preferenceScope ? hiddenPref : defaultHidden);
  const hidden = new Set(hiddenList);
  const setHidden = (next: string[]) => (p.onHiddenChange ? p.onHiddenChange(next) : setHiddenPref(next));
  const cols = visibleColumns(p.columns, hiddenList);
  const showMenu = p.columnMenu ?? (!!p.preferenceScope || !!p.onHiddenChange);

  const sorted = useMemo(() => {
    if (controlled) return p.rows ?? [];
    const col = sort ? p.columns.find((c) => c.id === sort.id) : undefined;
    return sortRows(p.rows ?? [], col?.sortKey, sort?.dir ?? "asc");
  }, [p.rows, p.columns, sort, controlled]);
  const ids = sorted.map(p.getId);
  const clickable = !!p.onRowClick || !!p.rowHref || !!p.onActiveChange;

  const open = (row: T) => {
    if (p.onRowClick) p.onRowClick(row);
    else if (p.rowHref) navigate(p.rowHref(row));
  };
  /** Én aktivering for desktop-rad, mobilkort og tastatur: velg (hvis styrt) og åpne. */
  const activate = (row: T) => {
    p.onActiveChange?.(p.getId(row));
    open(row);
  };
  /** Klikk på kontroller i raden/kortet (knapper, felt, lenker) skal ikke aktivere raden. */
  const fromControl = (target: EventTarget | null, container: Element) => {
    const el = target instanceof Element ? target : null;
    const hit = el?.closest(INTERACTIVE_SELECTOR);
    return !!hit && hit !== container && container.contains(hit);
  };

  useHotkeys(
    [
      { keys: ["j", "ArrowDown"], description: "Neste rad", handler: () => p.onActiveChange?.(stepRow(ids, p.activeId ?? null, 1)) },
      { keys: ["k", "ArrowUp"], description: "Forrige rad", handler: () => p.onActiveChange?.(stepRow(ids, p.activeId ?? null, -1)) },
      {
        keys: ["Enter"], description: "Åpne valgt rad",
        handler: () => { const r = sorted.find((x) => p.getId(x) === p.activeId); if (r) (p.onEnter ?? open)(r); },
      },
    ],
    { enabled: !!p.hotkeys && !!p.onActiveChange },
  );

  const toggleSort = (c: Column<T>) => {
    if (!c.sortKey) return;
    const next = (s: { id: string; dir: SortDir } | null) => (s?.id === c.id ? (s.dir === "asc" ? { id: c.id, dir: "desc" as const } : null) : { id: c.id, dir: "asc" as const });
    if (controlled) p.onSortChange?.(next(sort));
    else setLocalSort(next);
  };

  const onCheck = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    p.onSelectedChange?.(toggleSelection(ids, p.selected ?? new Set(), id, anchor.current, e.shiftKey));
    anchor.current = id;
  };
  const allOn = ids.length > 0 && ids.every((id) => p.selected?.has(id));

  return (
    <QueryState
      isLoading={!!p.isLoading && !p.rows}
      isError={!!p.error}
      error={p.error}
      scope={`ravarer:${p.ariaLabel}`}
      onRetry={p.onRetry}
      isEmpty={!p.isLoading && sorted.length === 0}
      emptyTitle={p.emptyText ?? "Ingen treff"}
      emptyDescription={p.emptyDescription}
    >
      {showMenu && (
        <div className="mb-2 flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5"><Columns3 className="h-3.5 w-3.5" aria-hidden />Kolonner</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Vis kolonner</DropdownMenuLabel>
              {p.columns.filter((c) => c.hideable && !c.alwaysVisible).map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={!hidden.has(c.id)}
                  onCheckedChange={(v) => setHidden(v ? [...hidden].filter((x) => x !== c.id) : [...hidden, c.id])}
                >
                  {c.menuLabel ?? c.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {p.renderMobileCard && (
        <ul className="space-y-2 md:hidden">
          {sorted.map((r) => (
            <li key={p.getId(r)} className={cn(p.selectable && "flex items-start gap-2")}>
              {p.selectable && (
                <span className="pt-3" onClick={(e) => onCheck(p.getId(r), e)}>
                  <Checkbox checked={p.selected?.has(p.getId(r)) ?? false} aria-label="Velg rad" />
                </span>
              )}
              {/* Ikke <button>: kortet kan ha egne knapper (ingen nøstede knapper). Knappene stopper klikket selv. */}
              <div
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-pressed={p.onActiveChange ? p.getId(r) === p.activeId : undefined}
                data-active={p.getId(r) === p.activeId || undefined}
                className={cn("w-full min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", clickable && "cursor-pointer", p.getId(r) === p.activeId && "ring-2 ring-primary/40")}
                onClick={(e) => { if (!clickable || fromControl(e.target, e.currentTarget)) return; activate(r); }}
                onKeyDown={(e) => { if (clickable && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); activate(r); } }}
              >
                {p.renderMobileCard?.(r)}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={cn("overflow-auto rounded-lg border border-border bg-card", p.renderMobileCard && "hidden md:block", p.scrollClassName)}>
        <table className="w-full text-sm tabular-nums" style={p.minTableWidth ? { minWidth: p.minTableWidth } : undefined} aria-label={p.ariaLabel}>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="h-9 border-b border-border text-caption text-muted-foreground">
              {p.selectable && (
                <th className="w-9 px-2">
                  <Checkbox
                    checked={allOn}
                    aria-label="Velg alle"
                    onCheckedChange={(v) => p.onSelectedChange?.(v ? new Set(ids) : new Set())}
                  />
                </th>
              )}
              {cols.map((c) => (
                <th key={c.id} style={{ width: c.width }} className={cn("px-3 font-medium", p.dense && "whitespace-nowrap", ALIGN[c.align ?? "left"])} aria-sort={sort?.id === c.id ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sortKey ? (
                    <button type="button" onClick={() => toggleSort(c)} className="inline-flex items-center gap-1 hover:text-foreground">
                      {c.header}
                      {sort?.id === c.id && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((r) => {
              const id = p.getId(r);
              const active = id === p.activeId;
              return (
                <tr
                  key={id}
                  aria-selected={active}
                  onClick={(e) => {
                    if (fromControl(e.target, e.currentTarget)) return;
                    if (window.getSelection()?.toString()) return;
                    activate(r);
                  }}
                  className={cn(
                    "h-9", clickable && "cursor-pointer hover:bg-muted/40",
                    active && "bg-primary/5 shadow-[inset_2px_0_0_0_hsl(var(--primary))]",
                    p.rowClassName?.(r),
                  )}
                >
                  {p.selectable && (
                    <td className="px-2" onClick={(e) => onCheck(id, e)}>
                      <Checkbox checked={p.selected?.has(id) ?? false} aria-label="Velg rad" onClick={(e) => e.preventDefault()} />
                    </td>
                  )}
                  {cols.map((c) => (
                    <td key={c.id} className={cn("px-3", p.dense && "whitespace-nowrap py-1", ALIGN[c.align ?? "left"])}>{c.cell(r)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {p.footer}
    </QueryState>
  );
}
