import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  GitCompareArrows,
  MoreVertical,
  Star,
  Trash2,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  useDeleteReportDefinition,
  useReportDefinitions,
  useToggleReportFavorite,
  type ReportDefinition,
} from "@/rapporter/hooks/useReportDefinitions";
import { REPORT_KIND_LABELS, reportHref, type ReportKind } from "@/rapporter/lib/reportConfig";

const KIND_ICONS: Record<ReportKind, LucideIcon> = {
  statistikk: BarChart3,
  trender: TrendingUp,
  kunder: Users,
  sammenligning: GitCompareArrows,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "nå nettopp";
  if (min < 60) return `for ${min} min siden`;
  const h = Math.round(min / 60);
  if (h < 24) return `for ${h} t siden`;
  const d = Math.round(h / 24);
  if (d < 31) return `for ${d} d siden`;
  return new Date(iso).toLocaleDateString("nb-NO", { dateStyle: "short" });
}

/** «Mine rapporter» — favoritter først, deretter øvrige lagrede utvalg. */
export function MyReportsCard() {
  const { data, isLoading } = useReportDefinitions();
  const toggle = useToggleReportFavorite();
  const remove = useDeleteReportDefinition();
  const [pendingDelete, setPendingDelete] = useState<ReportDefinition | null>(null);

  const rows = data ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Mine rapporter</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Ingen lagrede rapporter ennå — lagre et utvalg fra Statistikk, Trender, Kunder eller Sammenligning.
          </p>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {rows.map((r) => {
              const Icon = KIND_ICONS[r.report_kind] ?? BarChart3;
              return (
                <li key={r.id} className="flex items-center gap-2 px-4 py-2.5 hover:bg-surface-raised">
                  <button
                    type="button"
                    aria-label={r.is_favorite ? "Fjern favoritt" : "Marker som favoritt"}
                    onClick={() =>
                      toggle.mutate({ id: r.id, isFavorite: !r.is_favorite, name: r.display_name })
                    }
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Star
                      className={cn("h-4 w-4", r.is_favorite && "fill-amber-400 text-amber-500")}
                    />
                  </button>

                  <Link to={reportHref(r.report_kind, r.config)} className="flex min-w-0 flex-1 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--app-primary))]" />
                    <span className="truncate text-sm font-medium">{r.display_name}</span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {REPORT_KIND_LABELS[r.report_kind]}
                    </span>
                    <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground md:inline">
                      {r.created_by_name ? `${r.created_by_name} · ` : ""}
                      {relativeTime(r.created_at)}
                    </span>
                  </Link>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Handlinger">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setPendingDelete(r)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Slett
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette «{pendingDelete?.display_name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Rapporten er delt i selskapet og forsvinner for alle. Dette kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) remove.mutate({ id: pendingDelete.id, name: pendingDelete.display_name });
                setPendingDelete(null);
              }}
            >
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
