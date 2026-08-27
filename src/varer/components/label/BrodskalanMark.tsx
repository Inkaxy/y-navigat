import { cn } from "@/lib/utils";
import { brodskalanFor } from "@/varer/lib/brodskalan";

interface Props {
  /** Grovhetskategori fra `recipe_label_calculated.grain_category`. */
  category: string | null | undefined;
  /** Fysisk størrelse i millimeter (brukes på etikett-lignende visninger). */
  sizeMm?: number;
  className?: string;
  /** Vis nivånavn og prosentspenn under merket. Av som standard. */
  showText?: boolean;
  /** Dempet visning når grunnlaget er usikkert. */
  muted?: boolean;
}

/** Offisielt Brødskala'n-merke — vises kun når kategorien er beregnet. */
export function BrodskalanMark({ category, sizeMm, className, showText = false, muted = false }: Props) {
  const mark = brodskalanFor(category);
  if (!mark) return null;

  const sizeStyle = sizeMm ? { width: `${sizeMm}mm`, height: `${sizeMm}mm` } : undefined;

  return (
    <figure
      className={cn(
        "flex flex-col items-center gap-1",
        !sizeMm && !className && "h-16 w-16",
        muted && "opacity-50",
        className,
      )}
    >
      <img
        src={mark.src}
        alt={mark.alt}
        style={{
          ...sizeStyle,
          printColorAdjust: "exact",
          WebkitPrintColorAdjust: "exact",
        }}
        className={cn("object-contain", !sizeMm && "h-full w-full min-h-0")}
      />
      {showText && (
        <figcaption className="text-center text-xs leading-tight text-muted-foreground">
          <span className="font-semibold text-foreground">{mark.label}</span>
          <br />
          {mark.rangeText} grovhet
        </figcaption>
      )}
    </figure>
  );
}
