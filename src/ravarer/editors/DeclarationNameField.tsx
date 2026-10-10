import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Sparkles, Table2 } from "lucide-react";
import { toast } from "sonner";
import { suggestDeclarationName, useSaveDeclarationName } from "@/ravarer/hooks/useDeclarationNames";

export interface DeclarationNameFieldProps {
  rawMaterialId: string;
  /** Lagret deklarasjonsnavn. */
  value: string | null;
  /** Innkjøpsnavnet — grunnlag for «Foreslå». */
  rawMaterialName?: string | null;
  /** Koblet navn i Matvaretabellen, om noen. */
  matvaretabellenName?: string | null;
  disabled?: boolean;
  compact?: boolean;
  onSaved?: (value: string) => void;
}

/**
 * Eneste felt for deklarasjonsnavn. Samme validering og skrivevei
 * (`useSaveDeclarationName`) overalt — varekort, oppskrifter og arbeidslisten.
 */
export function DeclarationNameField({
  rawMaterialId, value, rawMaterialName, matvaretabellenName, disabled, compact, onSaved,
}: DeclarationNameFieldProps) {
  const save = useSaveDeclarationName();
  const saved = (value ?? "").trim();
  const [draft, setDraft] = useState(saved);
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => setDraft(saved), [saved, rawMaterialId]);

  const dirty = draft.trim() !== saved;
  const canSave = !disabled && dirty && !!draft.trim() && !save.isPending;

  async function propose() {
    setSuggesting(true);
    try {
      const s = await suggestDeclarationName(rawMaterialName ?? "");
      if (s) setDraft(s);
      else toast.info("Fant ingen god forslagstekst — skriv navnet manuelt");
    } catch (e) {
      toast.error(`Kunne ikke hente forslag: ${e instanceof Error ? e.message : "ukjent feil"}`);
    } finally {
      setSuggesting(false);
    }
  }

  const sz = compact ? "h-8" : "";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="Deklarasjonsnavn"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="f.eks. hvetemel"
        disabled={disabled}
        className={compact ? "h-8 w-48" : "max-w-xs"}
      />
      {!disabled && (
        <>
          {rawMaterialName && (
            <Button variant="outline" size="sm" className={sz} onClick={() => void propose()} disabled={suggesting}>
              {suggesting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              Foreslå
            </Button>
          )}
          {matvaretabellenName && (
            <Button variant="outline" size="sm" className={sz} onClick={() => setDraft(matvaretabellenName.split(",")[0].trim().toLowerCase())}>
              <Table2 className="mr-1.5 h-3.5 w-3.5" /> Bruk Matvaretabellen-navn
            </Button>
          )}
          <Button
            size="sm"
            className={sz}
            disabled={!canSave}
            onClick={() =>
              save.mutate(
                { rawMaterialId, declarationName: draft },
                { onSuccess: () => onSaved?.(draft.trim().toLowerCase()) },
              )
            }
          >
            {save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Lagre
          </Button>
          {dirty && (
            <Button variant="ghost" size="sm" className={sz} onClick={() => setDraft(saved)}>Avbryt</Button>
          )}
        </>
      )}
    </div>
  );
}
