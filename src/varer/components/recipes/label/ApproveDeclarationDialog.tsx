import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { nutritionDiff, wordDiff } from "@/varer/lib/declarationDiff";
import { stripHtml } from "@/varer/lib/effectiveDeclaration";

export interface ApproveSourceData {
  ingredientText: string | null;
  contains: string[];
  mayContain: string[];
  nutrition: Record<string, number | null> | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  calculated: ApproveSourceData | null;
  manual: ApproveSourceData | null;
  /** Gjeldende kilde før godkjenning. */
  currentMode: "auto" | "manual";
  blocked: boolean;
  saving: boolean;
  onApprove: (mode: "auto" | "manual", adopt: ApproveSourceData | null) => void;
}

function fmtNum(v: number | null): string {
  return v == null ? "—" : String(v).replace(".", ",");
}

/** Godkjenning med diff — kilden velges her, ingen bryter skriver umiddelbart. */
export function ApproveDeclarationDialog({
  open,
  onOpenChange,
  calculated,
  manual,
  currentMode,
  blocked,
  saving,
  onApprove,
}: Props) {
  const [mode, setMode] = useState<"auto" | "manual">(currentMode);

  const manualText = stripHtml(manual?.ingredientText ?? "");
  const calcText = stripHtml(calculated?.ingredientText ?? "");
  const from = mode === "auto" ? manualText : calcText;
  const to = mode === "auto" ? calcText : manualText;
  const parts = wordDiff(from, to);
  const nutRows = nutritionDiff(
    mode === "auto" ? manual?.nutrition ?? null : calculated?.nutrition ?? null,
    mode === "auto" ? calculated?.nutrition ?? null : manual?.nutrition ?? null,
  ).filter((r) => r.changed);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Godkjenn deklarasjon</DialogTitle>
          <DialogDescription>
            Velg hvilken kilde som skal gjelde. Endringen skrives først når du godkjenner, og synkes til de koblede
            produktene.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button variant={mode === "auto" ? "default" : "outline"} size="sm" onClick={() => setMode("auto")}>
            Beregnet
          </Button>
          <Button variant={mode === "manual" ? "default" : "outline"} size="sm" onClick={() => setMode("manual")}>
            Manuell / importert
          </Button>
        </div>

        <div className="max-h-72 space-y-3 overflow-auto rounded-lg border p-3 text-sm">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Ingrediensliste</div>
            {parts.every((p) => p.op === "same") ? (
              <p className="text-xs text-muted-foreground">Ingen endring i teksten.</p>
            ) : (
              <p className="leading-relaxed">
                {parts.map((p, i) => (
                  <span
                    key={i}
                    className={cn(
                      p.op === "added" && "rounded bg-emerald-500/15 text-emerald-800",
                      p.op === "removed" && "rounded bg-destructive/15 text-destructive line-through",
                    )}
                  >
                    {p.text}
                  </span>
                ))}
              </p>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Næring per 100 g</div>
            {nutRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ingen endring i næringstallene.</p>
            ) : (
              <ul className="space-y-0.5 text-xs">
                {nutRows.map((r) => (
                  <li key={r.key}>
                    {r.label}: <span className="text-destructive line-through">{fmtNum(r.from)}</span>{" "}
                    <span className="text-emerald-700">→ {fmtNum(r.to)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {mode === "manual" && !manual?.ingredientText && calculated?.ingredientText && (
            <Badge variant="outline">Beregnet tekst overtas som v1</Badge>
          )}

          {mode === "auto" && manual?.ingredientText && (
            <Button variant="outline" size="sm" onClick={() => setMode("manual")}>
              Overta importert tekst som v1
            </Button>
          )}
        </div>

        {blocked && (
          <p className="text-xs text-destructive">
            Godkjenning er sperret — pliktfelt mangler på etiketten. Rett de røde punktene først.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            disabled={blocked || saving}
            onClick={() =>
              onApprove(mode, mode === "manual" && !manual?.ingredientText ? calculated : null)
            }
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Godkjenn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
