import { useMemo, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { QueryState } from "@/components/common/QueryState";
import { useUiPreference } from "@/hooks/useUiPreference";
import { cn } from "@/lib/utils";
import { sortRows, stepRow, toggleSelection, type SortDir, type SortValue } from "@/ravarer/ui/dataTableLogic";
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
  ariaLabel: string;
};

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function DataTable<T>(p: Props<T>) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(null);
  const anchor = useRef<string | null>(null);
  const defaultHidden = useMemo(() => p.columns.filter((c) => c.defaultHidden).map((c) => c.id), [p.columns]);
  const [hiddenPref, setHiddenPref] = useUiPreference<string[]>(p.preferenceScope ?? "ravarer:datatable:ephemeral", defaultHidden);
  const hidden = new Set(p.preferenceScope ? hiddenPref : defaultHidden);
  const cols = p.columns.filter((c) => !hidden.has(c.id));

  const sorted = useMemo(() => {
    const col = sort ? p.columns.find((c) => c.id === sort.id) : undefined;
    return sortRows(p.rows ?? [], col?.sortKey, sort?.dir ?? "asc");
  }, [p.rows, p.columns, sort]);
  const ids = sorted.map(p.getId);

  const open = (row: T) => {
    if (p.onRowClick) p.onRowClick(row);
    else if (p.rowHref) navigate(p.rowHref(row));
  };

  useHotkeys(
    [
      { keys: ["j", "ArrowDown"], description: "Neste rad", handler: () => p.onActiveChange?.(stepRow(ids, p.activeId ?? null, 1)) },
      { keys: ["k", "ArrowUp"], description: "Forrige rad", handler: () => p.onActiveChange?.(stepRow(ids, p.activeId ?? null, -1)) },
      {
        keys: ["Enter"], description: "Åpne valgt rad",
        handler: () => { const r = sorted.find((x) => p.getId(x) === p.activeId); if (r) open(r); },
      },
    ],
    { enabled: !!p.hotkeys && !!p.onActiveChange },
  );

  const toggleSort = (c: Column<T>) => {
    if (!c.sortKey) return;
    setSort((s) => (s?.id === c.id ? (s.dir === "asc" ? { id: c.id, dir: "desc" } : null) : { id: c.id, dir: "asc" }));
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
      error={p.error ?? null}
      onRetry={p.onRetry}
      isEmpty={!p.isLoading && sorted.length === 0}
      emptyTitle={p.emptyText ?? "Ingen treff"}
    >
      {p.preferenceScope && (
        <div className="mb-2 flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5"><Columns3 className="h-3.5 w-3.5" aria-hidden />Kolonner</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Vis kolonner</DropdownMenuLabel>
              {p.columns.filter((c) => c.hideable).map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={!hidden.has(c.id)}
                  onCheckedChange={(v) => setHiddenPref(v ? [...hidden].filter((x) => x !== c.id) : [...hidden, c.id])}
                >
                  {c.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {p.renderMobileCard && (
        <ul className="space-y-2 md:hidden">
          {sorted.map((r) => (
            <li key={p.getId(r)}>
              <button type="button" className="w-full text-left" onClick={() => open(r)}>{p.renderMobileCard?.(r)}</button>
            </li>
          ))}
        </ul>
      )}
      <div className={cn("overflow-auto rounded-lg border border-border bg-card", p.renderMobileCard && "hidden md:block")}>
        <table className="w-full text-sm tabular-nums" aria-label={p.ariaLabel}>
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
                <th key={c.id} style={{ width: c.width }} className={cn("px-3 font-medium", ALIGN[c.align ?? "left"])} aria-sort={sort?.id === c.id ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
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
                  onClick={() => { p.onActiveChange?.(id); open(r); }}
                  className={cn(
                    "h-9 cursor-pointer hover:bg-muted/40",
                    active && "bg-primary/5 shadow-[inset_2px_0_0_0_hsl(var(--primary))]",
                  )}
                >
                  {p.selectable && (
                    <td className="px-2" onClick={(e) => onCheck(id, e)}>
                      <Checkbox checked={p.selected?.has(id) ?? false} aria-label="Velg rad" />
                    </td>
                  )}
                  {cols.map((c) => (
                    <td key={c.id} className={cn("px-3", ALIGN[c.align ?? "left"])}>{c.cell(r)}</td>
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
