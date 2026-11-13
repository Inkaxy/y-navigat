import LogoLang from "@/components/brand/svg/LogoLang";
import LogoRund from "@/components/brand/svg/LogoRund";
import LogoEmblem from "@/components/brand/svg/LogoEmblem";

type Variant = "horizontal" | "seal" | "monogram";

interface LogoProps {
  variant?: Variant;
  className?: string;
  title?: string;
}

/**
 * Nøtterø Bakeri brand-logo.
 * - `horizontal` — wordmark + monogram + 1898 (topmeny, e-post)
 * - `seal` — rundt segl med kringle og krone (login, empty-states)
 * - `monogram` — kun krone + pretzel + 1898 (favicon, watermark)
 *
 * Sort i SVG-ene er erstattet med `currentColor` slik at fargen
 * arves fra `color`-stilen på parent (Tailwind: `text-foreground`,
 * `text-bakery-cream`, etc.). Bronze-aksenten beholdes via
 * `--brand-bronze`-tokenet i index.css.
 */
export function Logo({ variant = "horizontal", className, title }: LogoProps) {
  const Cmp = variant === "seal" ? LogoRund : variant === "monogram" ? LogoEmblem : LogoLang;
  return <Cmp className={className} role={title ? "img" : "presentation"} aria-label={title} />;
}
