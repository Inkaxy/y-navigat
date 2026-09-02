import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calculator, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPct } from "@/varer/lib/breadscale";
import { relativeTimeNb } from "./labelShared";
import type { RecipeLinkedProduct } from "@/varer/hooks/useRecipeLabel";

interface Props {
  computedAt: string | null | undefined;
  coveragePct: number | null;
  declarationManual: boolean;
  breadscaleManual: boolean;
  linkedProducts: RecipeLinkedProduct[];
  canWrite: boolean;
  computing: boolean;
  onRecompute: () => void;
}

/** Statuslinje øverst i merkefanen — beregningstidspunkt, dekning og hva som følger produktene. */
export function LabelStatusBar({
  computedAt,
  coveragePct,
  declarationManual,
  breadscaleManual,
  linkedProducts,
  canWrite,
  computing,
  onRecompute,
}: Props) {
  const coverageOk = (coveragePct ?? 0) >= 90;

  return (
    <div className="sticky top-0 z-20 -mx-1 rounded-lg border bg-card/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm">
          {computedAt ? (
            <>
              Beregnet <b>{relativeTimeNb(computedAt)}</b> av NBhub
            </>
          ) : (
            <span className="text-muted-foreground">Ikke beregnet ennå</span>
          )}
        </span>

        {coveragePct != null && (
          <Badge
            variant="outline"
            className={cn(
              "tabular-nums",
              coverageOk
                ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-700"
                : "border-amber-500/50 bg-amber-500/10 text-amber-700",
            )}
          >
            Næringsdekning {fmtPct(coveragePct, 0)}
          </Badge>
        )}

        <div className="flex-1" />

        {canWrite && (
          <Button variant="outline" size="sm" onClick={onRecompute} disabled={computing}>
            {computing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Calculator className="mr-2 h-4 w-4" />
            )}
            Beregn på nytt
          </Button>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          Følger produktene: Deklarasjon &amp; næring —{" "}
          <b className="text-foreground">{declarationManual ? "Manuell" : "Beregnet"}</b> · Grovhet —{" "}
          <b className="text-foreground">{breadscaleManual ? "Manuell" : "Beregnet"}</b>
        </span>
        <span>·</span>
        <span>{linkedProducts.length} koblede produkter</span>
        {linkedProducts.map((l) => (
          <Link
            key={l.id}
            to={`/varer/vareliste/${l.product_id}?tab=deklarasjon`}
            className="rounded-full border px-2 py-0.5 text-foreground hover:bg-muted"
          >
            {l.products?.display_name ?? "Uten navn"}
            {l.is_primary ? " ★" : ""}
          </Link>
        ))}
      </div>
    </div>
  );
}
