import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { ConsumerLabelSection } from "./ConsumerLabelSection";

type LabelProps = ComponentProps<typeof ConsumerLabelSection>;

interface Props {
  /** Sist godkjente versjon, eller null når ingen er godkjent. */
  approved: { version: number; props: LabelProps } | null;
  draft: LabelProps;
  declarationManual: boolean;
}

/**
 * Etiketten: sist godkjente versjon er standard for forhåndsvisning og utskrift.
 * Kladden holdes montert (skjult) så pliktfeltsjekken fortsatt gjelder den nye beregningen.
 */
export function LabelPreviewPanel({ approved, draft, declarationManual }: Props) {
  const [source, setSource] = useState<"approved" | "draft">("approved");
  const shown = approved ? source : "draft";
  return (
    <div id="merking-etikett" tabIndex={-1} className="scroll-mt-4 space-y-2 outline-none">
      <p className="text-xs text-muted-foreground">
        {approved
          ? "Standard er sist godkjente versjon — det som gjelder for etikett og API til en ny versjon godkjennes. «Ny beregning» er bare et forslag."
          : `Ingen godkjent versjon ennå — forhåndsvisningen er en kladd (${declarationManual ? "manuell" : "beregnet"}).`}{" "}
        Ulagrede endringer i redigeringsfeltene vises ikke her og påvirker ikke utskrift eller API.
      </p>
      {approved && (
        <div role="group" aria-label="Kilde for etiketten" className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={shown === "approved" ? "default" : "outline"} className="min-h-11" aria-pressed={shown === "approved"} onClick={() => setSource("approved")}>
            Sist godkjente (versjon {approved.version})
          </Button>
          <Button type="button" size="sm" variant={shown === "draft" ? "default" : "outline"} className="min-h-11" aria-pressed={shown === "draft"} onClick={() => setSource("draft")}>
            Ny beregning – forslag
          </Button>
        </div>
      )}
      {approved && shown === "approved" && <ConsumerLabelSection {...approved.props} />}
      <div className={shown === "draft" ? undefined : "hidden"}>
        <ConsumerLabelSection {...draft} />
      </div>
    </div>
  );
}
