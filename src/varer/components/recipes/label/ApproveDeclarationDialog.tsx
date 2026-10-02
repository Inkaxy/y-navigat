import { useEffect, useState } from "react";
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
import { stripHtml } from "@/varer/lib/effectiveDeclaration";
import { DeclarationDiffView, declarationDocsDiffer, type DeclarationDoc } from "./DeclarationDiffView";
import { formatDateTimeNb } from "./labelShared";

export type ApproveSourceData = DeclarationDoc;

export interface ApproveAffectedProduct {
  id: string;
  name: string;
  number: string | null;
}

export interface PreviousApproval {
  version: number;
  approvedAt: string;
  source: string;
  doc: DeclarationDoc;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  calculated: ApproveSourceData | null;
  /** LAGREDE manuelle verdier — det RPC-en faktisk godkjenner. */
  manual: ApproveSourceData | null;
  /** Kilden brukeren har valgt i editoren. */
  currentMode: "auto" | "manual";
  /** Pliktfelt som mangler per kilde — sperrer bare den kilden de gjelder. */
  issues: { auto: string[]; manual: string[] };
  /** Ulagret manuell kladd: manuell godkjenning sperres til kladden er lagret. */
  manualDirty: boolean;
  previous: PreviousApproval | null;
  affected: ApproveAffectedProduct[];
  saving: boolean;
  onApprove: (mode: "auto" | "manual", adopt: ApproveSourceData | null) => void;
}

/** Godkjenning med faktisk kandidat, diff mot forrige godkjente versjon og berørte varer. */
export function ApproveDeclarationDialog(p: Props) {
  const [mode, setMode] = useState<"auto" | "manual">(p.currentMode);
  useEffect(() => {
    if (p.open) setMode(p.currentMode);
  }, [p.open, p.currentMode]);

  // Tom manuell + valgt manuell: beregnet tekst overtas som første manuelle versjon (eksisterende kontrakt).
  const adopt = mode === "manual" && !p.manual?.ingredientText ? p.calculated : null;
  const candidate: DeclarationDoc | null = mode === "auto" ? p.calculated : adopt ?? p.manual;
  const modeIssues = mode === "auto" ? p.issues.auto : p.issues.manual;
  const dirtyBlock = mode === "manual" && p.manualDirty;
  const noCandidate = !candidate || !stripHtml(candidate.ingredientText ?? "").trim();
  const blocked = modeIssues.length > 0 || dirtyBlock || noCandidate;
  const unchanged = !!p.previous && !!candidate && !declarationDocsDiffer(p.previous.doc, candidate);

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Godkjenn deklarasjon</DialogTitle>
          <DialogDescription>
            Dette blir den gjeldende deklarasjonen: den som skrives ut på etiketten, sendes ut i API-et og følger de
            koblede varene.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Kilde som godkjennes">
          <Button variant={mode === "auto" ? "default" : "outline"} size="sm" onClick={() => setMode("auto")}>
            Beregnet
          </Button>
          <Button variant={mode === "manual" ? "default" : "outline"} size="sm" onClick={() => setMode("manual")}>
            Manuell / importert
          </Button>
        </div>

        <section aria-label="Kandidat" className="space-y-1 rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Dette godkjennes</span>
            {adopt && <Badge variant="outline">Beregnet tekst overtas som manuell</Badge>}
            {mode === "manual" && !adopt && <Badge variant="outline">Lagret manuell kladd</Badge>}
          </div>
          <p className="leading-relaxed">{stripHtml(candidate?.ingredientText ?? "") || "—"}</p>
          {candidate && candidate.contains.length > 0 && (
            <p className="text-xs">Inneholder: {candidate.contains.join(", ")}</p>
          )}
          {candidate && candidate.mayContain.length > 0 && (
            <p className="text-xs">Kan inneholde spor av: {candidate.mayContain.join(", ")}</p>
          )}
        </section>

        <section aria-label="Endringer siden sist" className="rounded-lg border p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            {p.previous
              ? `Endringer siden v${p.previous.version} (godkjent ${formatDateTimeNb(p.previous.approvedAt)})`
              : "Første godkjenning — ingen tidligere versjon"}
          </div>
          {candidate && p.previous && unchanged && (
            <p className="text-xs text-muted-foreground">Innholdet er likt forrige godkjente versjon.</p>
          )}
          {candidate && p.previous && !unchanged && (
            <DeclarationDiffView
              from={p.previous.doc}
              to={candidate}
              fromLabel={`v${p.previous.version}`}
              toLabel="ny versjon"
            />
          )}
        </section>

        <section aria-label="Berørte varer" className="rounded-lg border p-3 text-sm">
          <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Berørte varer ({p.affected.length})
          </div>
          {p.affected.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Ingen varer er koblet til oppskriften. Godkjenningen oppdaterer derfor ingen varer.
            </p>
          ) : (
            <ul className="max-h-32 space-y-0.5 overflow-auto text-xs">
              {p.affected.map((a) => (
                <li key={a.id}>
                  {a.number ? `${a.number} · ` : ""}
                  {a.name}
                </li>
              ))}
            </ul>
          )}
        </section>

        {blocked && (
          <div role="alert" className="text-xs text-destructive">
            <p>Godkjenning er sperret:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {dirtyBlock && <li>Den manuelle kladden har ulagrede endringer — trykk «Lagre kladd» først.</li>}
              {noCandidate && !dirtyBlock && <li>Valgt kilde har ingen ingrediensliste.</li>}
              {modeIssues.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => p.onOpenChange(false)}>
            Avbryt
          </Button>
          <Button disabled={blocked || p.saving} onClick={() => p.onApprove(mode, adopt)}>
            {p.saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Godkjenn{p.affected.length ? ` og oppdater ${p.affected.length} vare${p.affected.length === 1 ? "" : "r"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
