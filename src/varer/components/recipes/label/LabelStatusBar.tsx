import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BadgeCheck, Calculator, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPct } from "@/varer/lib/breadscale";
import { formatDateTimeNb, relativeTimeNb } from "./labelShared";

function formatDateNb(iso: string | null): string {
  return iso ? formatDateTimeNb(iso) : "ukjent dato";
}
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
  /** Merkestatus: godkjent / utdatert / mangler. */
  status: "approved" | "stale" | "missing";
  approvedAt: string | null;
  approvedByName: string | null;
  /** Hva som gjorde beregningen utdatert, f.eks. «Hvetemel». */
  staleSourceName: string | null;
  staleSourceAt: string | null;
  allergenReviewed: boolean;
  declarationNamed: boolean;
  approving: boolean;
  onApprove: () => void;
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
  status,
  approvedAt,
  approvedByName,
  staleSourceName,
  staleSourceAt,
  allergenReviewed,
  declarationNamed,
  approving,
  onApprove,
}: Props) {
  const coverageOk = (coveragePct ?? 0) >= 90;

  return (
    <div className="sticky top-0 z-20 -mx-1 rounded-lg border bg-card/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge
          variant="outline"
          className={cn(
            status === "approved" && "border-emerald-600/40 bg-emerald-500/10 text-emerald-700",
            status === "stale" && "border-amber-500/50 bg-amber-500/10 text-amber-700",
            status === "missing" && "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {status === "approved"
            ? `Godkjent · ${formatDateNb(approvedAt)}${approvedByName ? ` · av ${approvedByName}` : ""}`
            : status === "stale"
              ? staleSourceName
                ? `Utdatert – ${staleSourceName} endret ${formatDateNb(staleSourceAt)}`
                : "Utdatert"
              : "Aldri godkjent"}
        </Badge>

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

        <Badge variant="outline" className={cn(allergenReviewed ? "" : "border-amber-500/50 text-amber-700")}>
          Allergen-gjennomgang {allergenReviewed ? "OK" : "mangler"}
        </Badge>
        <Badge variant="outline" className={cn(declarationNamed ? "" : "border-amber-500/50 text-amber-700")}>
          Deklarasjonsnavn {declarationNamed ? "OK" : "mangler"}
        </Badge>

        {canWrite && (
          <Button size="sm" onClick={onApprove} disabled={approving}>
            {approving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}
            Godkjenn deklarasjon
          </Button>
        )}

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
