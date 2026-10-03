import { useId, useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WARNING_TITLE, type RecipeWarning, type RecipeWarningKind } from "@/varer/hooks/useRecipeWarnings";
import { distinctActions, groupRecipeWarnings } from "@/varer/lib/recipeWarningGroups";

/**
 * Kompakt sammendrag av live-advarslene i oppskriftseditoren. Viser antall
 * problemer og berørte ingredienser; detaljene er gruppert per linje og kan
 * foldes ut. Rådgivende: blokkerer aldri lagring.
 */
export function RecipeWarningsBanner({
  warnings,
  open,
  onOpenChange,
  onFocusLine,
}: {
  warnings: RecipeWarning[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFocusLine: (lineId: string) => void;
}) {
  const panelId = useId();
  const summary = useMemo(() => groupRecipeWarnings(warnings), [warnings]);
  if (summary.problemCount === 0) return null;

  const kinds = Object.entries(summary.byKind) as [RecipeWarningKind, number][];
  const headline =
    summary.affectedLineCount > 0
      ? `${summary.problemCount} ${summary.problemCount === 1 ? "problem" : "problemer"} på ${summary.affectedLineCount} ${summary.affectedLineCount === 1 ? "ingrediens" : "ingredienser"}`
      : `${summary.problemCount} ${summary.problemCount === 1 ? "ting" : "ting"} bør ses på`;

  return (
    <section id="oppskrift-advarsler" aria-label="Ting som bør ses på" className="scroll-mt-48 rounded-md border border-warning/40 bg-warning/10">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-sm font-medium">{headline}</p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Fordelt på type">
          {kinds.map(([kind, n]) => (
            <li key={kind} className="rounded-full border border-warning/30 bg-background/60 px-2 py-0.5 text-caption text-muted-foreground">
              {WARNING_TITLE[kind]}: {n}
            </li>
          ))}
        </ul>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onOpenChange(!open)}
        >
          {open ? "Skjul detaljer" : "Vis detaljer"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </Button>
      </div>

      <div id={panelId} hidden={!open} className="border-t border-warning/30 px-3 py-2">
        <ul className="divide-y divide-warning/20">
          {summary.groups.map((g) => (
            <li key={g.key} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{g.name ?? "Hele oppskriften"}</span>
                {g.lineId && (
                  <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-caption" onClick={() => onFocusLine(g.lineId!)}>
                    <Crosshair className="h-3.5 w-3.5" aria-hidden="true" /> Gå til linjen
                  </Button>
                )}
                {distinctActions(g.items).map((a) => (
                  <Link key={a.href} to={a.href} className="text-caption underline underline-offset-2 hover:text-foreground">
                    {a.label}
                  </Link>
                ))}
              </div>
              <ul className="mt-1 space-y-0.5 text-sm">
                {g.items.map((w, i) => (
                  <li key={`${w.kind}-${i}`} className="flex flex-wrap gap-x-2">
                    <span className="text-muted-foreground">{WARNING_TITLE[w.kind]}:</span>
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
