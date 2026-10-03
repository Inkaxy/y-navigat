import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/Logo";

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
  className,
}: PageHeaderProps) {
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
      {watermark && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-8 hidden text-brand-bronze opacity-[0.06] md:block"
        >
          <Logo variant="monogram" className="h-40 w-40" />
        </div>
      )}

      <div className="relative flex items-start justify-between gap-4 px-5 py-5 md:px-6 md:py-6">
        <div className="flex min-w-0 items-start gap-3.5">
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
                className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"
              >
                {crumbs.map((c, i) => {
                  const last = i === crumbs.length - 1;
                  return (
                    <span key={i} className="flex items-center gap-1">
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
              className="mt-1 font-display text-[1.6rem] font-semibold leading-tight tracking-tight text-foreground md:text-[1.85rem]"
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
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
