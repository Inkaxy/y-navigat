import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalLink, Loader2, Save } from "lucide-react";
import { useSaveDeclarationName } from "@/ravarer/hooks/useDeclarationNames";
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

/** Lar brukeren fylle inn lovlige ingrediensnavn direkte fra datakvalitet-kortet. */
export function MissingDeclarationNames({ rows, canWrite, onSaved }: Props) {
  const save = useSaveDeclarationName();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setValues((prev) => {
      const next = { ...prev };
      for (const r of rows) if (next[r.raw_material_id] === undefined) next[r.raw_material_id] = r.fallback_used ?? "";
      return next;
    });
  }, [rows]);

  async function saveRow(id: string) {
    setBusy(id);
    try {
      await save.mutateAsync({ rawMaterialId: id, declarationName: values[id] ?? "" });
      onSaved();
    } catch {
      /* toast håndteres i hooken */
    } finally {
      setBusy(null);
    }
  }

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
          <Input
            value={values[r.raw_material_id] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [r.raw_material_id]: e.target.value }))}
            placeholder="f.eks. hvetemel"
            disabled={!canWrite}
            className="h-9 w-56"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!canWrite || busy === r.raw_material_id || !(values[r.raw_material_id] ?? "").trim()}
            onClick={() => saveRow(r.raw_material_id)}
          >
            {busy === r.raw_material_id ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Lagre
          </Button>
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
  const save = useSaveDeclarationName();
  const [value, setValue] = useState(fallback ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="Deklarasjonsnavn"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="f.eks. hvetemel"
        disabled={disabled}
        className="h-8 w-48"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={disabled || save.isPending || !value.trim()}
        onClick={() =>
          save.mutate({ rawMaterialId, declarationName: value }, { onSuccess: () => onSaved() })
        }
      >
        {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
        Lagre navn
      </Button>
    </div>
  );
}
