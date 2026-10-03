import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronsUpDown, Link2, Wheat } from "lucide-react";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { fmtG, fmtPercent, RECIPE_STATUS_LABEL } from "@/varer/lib/bakers";
import { BASE_RECIPE_CATEGORY } from "@/varer/lib/halvfabrikat";
import { asDepartment, RECIPE_DEPARTMENT_BADGE, RECIPE_DEPARTMENT_LABEL } from "@/varer/lib/departments";
import type { RecipeSortKey } from "@/varer/lib/listUrlState";
import type { RecipeRow } from "@/varer/hooks/useRecipeListData";
import { LabelingBadge } from "@/varer/components/lists/LabelingBadge";
import { RecipeRowMenu } from "@/varer/components/recipes/list/RecipeRowMenu";

type Sort = { key: RecipeSortKey; dir: "asc" | "desc" };

/** Klikk på raden utenfor lenker/knapper åpner oppskriften, som før. */
function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("a, button, input, select, [role='menuitem']");
}

/** Skannbar tabell for brede skjermer. */
export function RecipeListTable({
  rows, sort, onSort, hrefFor, shareCounts, canWrite, copyingId, onCopy, onDelete,
}: {
  rows: RecipeRow[];
  sort: Sort;
  onSort: (key: RecipeSortKey) => void;
  hrefFor: (id: string) => string;
  shareCounts: Record<string, number>;
  canWrite: boolean;
  copyingId: string | null;
  onCopy: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const navigate = useNavigate();
  const th = { sort, onSort };

  function onRowClick(e: MouseEvent, id: string) {
    if (isInteractive(e.target)) return;
    if (e.metaKey || e.ctrlKey) {
      window.open(hrefFor(id), "_blank", "noopener");
      return;
    }
    navigate(hrefFor(id));
  }

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Oppskrifter. Kolonneoverskriftene kan sorteres.</caption>
      <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
        <tr>
          <SortableTh label="Oppskrift" sortKey="name" {...th} />
          <SortableTh label="Kategori" sortKey="category" {...th} />
          <SortableTh label="Avdeling" sortKey="department" {...th} />
          <SortableTh label="Hydrering" sortKey="hydration" {...th} align="right" />
          <SortableTh label="Deigvekt" sortKey="dough" {...th} align="right" />
          <SortableTh label="Produkter" sortKey="products" {...th} />
          <SortableTh label="Status" sortKey="status" {...th} />
          <SortableTh label="Merking" sortKey="labeling" {...th} />
          <SortableTh label="Oppdatert" sortKey="updated" {...th} />
          <th className="w-10 px-2 py-2.5"><span className="sr-only">Handlinger</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const name = r.name || "Uten navn";
          const d = asDepartment(r.department);
          return (
            <tr
              key={r.id}
              onClick={(e) => onRowClick(e, r.id)}
              className={`cursor-pointer border-t border-border hover:bg-muted/40 ${i % 2 === 1 ? "bg-muted/20" : ""}`}
            >
              <td className="max-w-[22rem] px-4 py-2.5">
                <div className="flex items-center gap-2">
                  {r.image_url && (
                    <img src={r.image_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" />
                  )}
                  <Link
                    to={hrefFor(r.id)}
                    data-focus-id={r.id}
                    className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {name}
                  </Link>
                  {shareCounts[r.id] > 0 && (
                    <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[11px] font-normal" title="Aktive delingslenker">
                      <Link2 className="h-3 w-3" aria-hidden="true" />
                      {shareCounts[r.id]}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">v{r.version}</div>
              </td>
              <td className="px-4 py-2.5">
                {r.category === BASE_RECIPE_CATEGORY ? (
                  <Badge variant="outline" className="gap-1 border-app/50 text-app">
                    <Wheat className="h-3.5 w-3.5" aria-hidden="true" /> Grunnoppskrift
                  </Badge>
                ) : (
                  r.category ?? "—"
                )}
              </td>
              <td className="px-4 py-2.5">
                {d ? (
                  <Badge variant="outline" className={`font-normal ${RECIPE_DEPARTMENT_BADGE[d]}`}>{RECIPE_DEPARTMENT_LABEL[d]}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtPercent(r.totals.hydrationPct)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtG(r.totals.totalDoughG)} g</td>
              <td className="max-w-[14rem] px-4 py-2.5">
                {r.products.length === 0 ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <span className="text-xs">{r.products.slice(0, 2).join(", ")}{r.products.length > 2 ? ` +${r.products.length - 2}` : ""}</span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <Badge variant="outline">{RECIPE_STATUS_LABEL[r.status ?? "draft"] ?? r.status}</Badge>
              </td>
              <td className="px-4 py-2.5"><LabelingBadge status={r.labeling} /></td>
              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                {r.updated_at ? format(new Date(r.updated_at), "EEE d. MMM yyyy, HH:mm", { locale: nb }) : "—"}
              </td>
              <td className="px-2 py-2.5 text-right">
                {canWrite && (
                  <RecipeRowMenu
                    name={name}
                    copying={copyingId === r.id}
                    onCopy={() => onCopy(r.id)}
                    onDelete={() => onDelete(r.id, name)}
                  />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Klikkbar kolonneoverskrift med sorteringsindikator. */
function SortableTh({
  label, sortKey, sort, onSort, align = "left",
}: {
  label: string;
  sortKey: RecipeSortKey;
  sort: Sort;
  onSort: (key: RecipeSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={`px-4 py-2.5 ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase transition-colors hover:text-foreground ${active ? "text-foreground" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? "" : "opacity-40"}`} aria-hidden="true" />
      </button>
    </th>
  );
}
