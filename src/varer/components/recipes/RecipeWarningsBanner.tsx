import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { WARNING_TITLE, type RecipeWarning } from "@/varer/hooks/useRecipeWarnings";

/**
 * Samlebanner for live-advarslene i oppskriftseditoren.
 * Rådgivende: det blokkerer aldri lagring, men peker rett på stedet feilen rettes.
 */
export function RecipeWarningsBanner({ warnings }: { warnings: RecipeWarning[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
        {warnings.length === 1 ? "1 ting bør ses på" : `${warnings.length} ting bør ses på`}
      </div>
      <ul className="mt-1.5 space-y-1 text-sm">
        {warnings.map((w, i) => (
          <li key={`${w.kind}-${w.lineId ?? i}`} className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{WARNING_TITLE[w.kind]}:</span>
            <span>{w.message}</span>
            {w.action && (
              <Link to={w.action.href} className="underline underline-offset-2 hover:text-foreground">
                {w.action.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
