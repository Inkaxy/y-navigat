import { DeclarationNameField } from "@/ravarer/editors/DeclarationNameField";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { paths } from "@/ravarer/lib/paths";

export interface MissingDeclarationNameRow {
  raw_material_id: string;
  name: string;
  fallback_used: string;
}

interface Props {
  rows: MissingDeclarationNameRow[];
  canWrite: boolean;
  onSaved: () => void;
}

/** Lar brukeren fylle inn lovlige ingrediensnavn direkte fra datakvalitet-kortet. Samme felt og skrivevei som resten. */
export function MissingDeclarationNames({ rows, canWrite, onSaved }: Props) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Mangler deklarasjonsnavn
        </span>
        <Badge variant="outline">{rows.length} råvarer</Badge>
      </div>
      <p className="pb-1 text-xs text-muted-foreground">
        Innkjøpsnavnet brukes midlertidig. Skriv det lovlige ingrediensnavnet — små bokstaver, aldri merkenavn eller
        pakning.
      </p>
      {rows.map((r) => (
        <div
          key={r.raw_material_id}
          className="flex flex-wrap items-center gap-2 border-b border-border/50 py-2 last:border-0"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{r.name}</div>
            <Link
              to={paths.raavare(r.raw_material_id)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Åpne råvarekortet <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <DeclarationNameField
            rawMaterialId={r.raw_material_id}
            value={null}
            initialDraft={r.fallback_used}
            rawMaterialName={r.name}
            disabled={!canWrite}
            compact
            onSaved={() => onSaved()}
          />
        </div>
      ))}
    </div>
  );
}

/** Én rad: lovlig ingrediensnavn rett fra datakvalitet-oppgavelisten. */
export function DeclarationNameInline({
  rawMaterialId,
  fallback,
  disabled,
  onSaved,
}: {
  rawMaterialId: string;
  fallback: string | null;
  disabled: boolean;
  onSaved: () => void;
}) {
  return (
    <DeclarationNameField
      rawMaterialId={rawMaterialId}
      value={null}
      initialDraft={fallback}
      disabled={disabled}
      compact
      onSaved={() => onSaved()}
    />
  );
}
