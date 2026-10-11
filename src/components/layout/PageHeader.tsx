import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/Logo";
import { EmbeddedActions, useIsEmbedded } from "@/ravarer/ui/EmbeddedContext";

export interface Crumb {
  label: string;
  to?: string;
}

export interface PageHeaderProps {
  /** Liten majuskel-tekst over tittelen (f.eks. seksjons-/app-navn). */
  eyebrow?: string;
  /** Hovedtittel — rendres i Fraunces display. */
  title: string;
  /** Kort beskrivende undertekst. */
  subtitle?: string;
  /** Valgfri ikonbadge til venstre (matcher tidligere AppHeaderBanner). */
  icon?: LucideIcon;
  /** Brødsmuler over eyebrow. */
  crumbs?: Crumb[];
  /** Knapper / actions til høyre. */
  actions?: ReactNode;
  /** Subtil monogram-watermark i bakgrunnen. */
  watermark?: boolean;
  /** Kompakt arbeidsflatehode (mindre luft og tittel, uten watermark). */
  compact?: boolean;
  className?: string;
}

/**
 * Universell sidehode for NBhub. Erstatter den gamle AppHeaderBanner-stilen
 * med Fraunces-display-tittel, bronze-eyebrow og valgfri monogram-watermark.
 *
 * Strukturen er bevart — gamle props (`icon`, `title`, `subtitle`, `actions`)
 * fungerer fortsatt slik at `AppHeaderBanner` kan delegere hit uten endringer
 * for kalleren.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  crumbs,
  actions,
  watermark = true,
  compact = false,
  className,
}: PageHeaderProps) {
  const embedded = useIsEmbedded();
  if (embedded) return <EmbeddedActions>{actions}</EmbeddedActions>;
  return (
    <header
      className={cn(
        "relative overflow-hidden rounded-2xl border border-line-subtle",
        className,
      )}
      style={{
        background:
          "radial-gradient(140% 140% at 100% 0%, hsl(var(--brand-bronze) / 0.07) 0%, transparent 55%), linear-gradient(180deg, hsl(var(--surface-raised)) 0%, hsl(var(--background)) 100%)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      {watermark && !compact && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-8 hidden text-brand-bronze opacity-[0.06] md:block"
        >
          <Logo variant="monogram" className="h-40 w-40" />
        </div>
      )}

      {/* Mobil: tittel/brødsmuler i full bredde, handlinger på egen rad under. Fra md: side om side. */}
      <div className={cn("relative flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4", compact ? "px-4 py-3 md:px-5 md:py-3.5" : "px-4 py-4 md:px-6 md:py-6")}>
        <div className="flex w-full min-w-0 items-start gap-3.5 md:w-auto md:flex-1">
          {Icon && (
            <span
              aria-hidden
              className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line-subtle bg-surface-raised text-ink-primary"
            >
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            {crumbs && crumbs.length > 0 && (
              <nav
                aria-label="Brødsmuler"
                className="mb-1 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground"
              >
                {crumbs.map((c, i) => {
                  const last = i === crumbs.length - 1;
                  return (
                    <span key={i} className="flex min-w-0 max-w-full items-center gap-1 break-words">
                      {c.to && !last ? (
                        <Link
                          to={c.to}
                          className="hover:text-foreground hover:underline underline-offset-2"
                        >
                          {c.label}
                        </Link>
                      ) : (
                        <span className={last ? "text-foreground/80" : ""}>{c.label}</span>
                      )}
                      {!last && <ChevronRight className="h-3 w-3 opacity-50" />}
                    </span>
                  );
                })}
              </nav>
            )}
            {eyebrow && (
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-brand-bronze">
                {eyebrow}
              </div>
            )}
            <h1
              className={cn(
                "mt-1 font-display font-semibold leading-tight tracking-tight text-foreground [overflow-wrap:anywhere]",
                compact ? "text-[1.3rem] md:text-[1.45rem]" : "text-[1.45rem] md:text-[1.85rem]",
              )}
              style={{ letterSpacing: "-0.02em", fontVariationSettings: "'opsz' 144" }}
            >
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && (
          // Under md: egen rad, bryter linje, og knapper/lenker får minst 44 CSS-px trefflate (px, ikke rem).
          <div className="flex w-full flex-wrap items-center gap-2 max-md:[&_a]:min-h-[44px] max-md:[&_button]:min-h-[44px] max-md:[&_button]:min-w-[44px] md:w-auto md:shrink-0 md:justify-end">{actions}</div>
        )}
      </div>
    </header>
  );
}
