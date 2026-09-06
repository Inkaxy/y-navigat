import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import {
  useDeclarationWorklist,
  useSaveDeclarationName,
  type DeclarationWorklistRow,
} from "@/ravarer/hooks/useDeclarationNames";

function initialFor(r: DeclarationWorklistRow) {
  return (r.matvaretabellen_name ?? r.suggested_name ?? "").trim().toLowerCase();
}

export default function Deklarasjonsnavn() {
  const { legalEntityId, canWrite } = useRavarer();
  const { data: rows = [], isLoading } = useDeclarationWorklist(legalEntityId);
  const save = useSaveDeclarationName();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  useEffect(() => {
    setValues((prev) => {
      const next = { ...prev };
      for (const r of rows) if (next[r.raw_material_id] === undefined) next[r.raw_material_id] = initialFor(r);
      return next;
    });
  }, [rows]);

  const simple = useMemo(() => rows.filter((r) => !r.is_composite), [rows]);
  const composite = useMemo(() => rows.filter((r) => r.is_composite), [rows]);
  const filledCount = simple.filter((r) => (values[r.raw_material_id] ?? "").trim()).length;

  async function saveOne(id: string) {
    setBusy(id);
    try {
      await save.mutateAsync({ rawMaterialId: id, declarationName: values[id] ?? "" });
    } catch {
      /* toast i hooken */
    } finally {
      setBusy(null);
    }
  }

  async function saveAll() {
    setSavingAll(true);
    let ok = 0;
    for (const r of simple) {
      const v = (values[r.raw_material_id] ?? "").trim();
      if (!v) continue;
      try {
        await save.mutateAsync({ rawMaterialId: r.raw_material_id, declarationName: v });
        ok++;
      } catch {
        /* fortsetter */
      }
    }
    setSavingAll(false);
    toast.success(`${ok} deklarasjonsnavn lagret`);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Deklarasjonsnavn"
        subtitle="Råvarer i bruk som mangler lovlig ingrediensnavn. Tyngst brukt først."
      />

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-ink-secondary">
            {isLoading ? "Laster …" : `${simple.length} råvarer mangler navn`}
          </div>
          {canWrite && simple.length > 0 && (
            <Button size="sm" onClick={saveAll} disabled={savingAll || filledCount === 0}>
              {savingAll ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              Lagre alle utfylte ({filledCount})
            </Button>
          )}
        </div>

        {!isLoading && simple.length === 0 && (
          <p className="text-sm text-ink-secondary">Alle råvarer i bruk har deklarasjonsnavn.</p>
        )}

        <div className="divide-y divide-border">
          {simple.map((r) => (
            <div key={r.raw_material_id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <Link to={`/ravarer/vareliste/${r.raw_material_id}`} className="truncate text-sm font-medium hover:underline">
                  {r.name}
                </Link>
                <div className="text-xs tabular-nums text-ink-secondary">
                  Brukes i {r.recipes_using} oppskrift{r.recipes_using === 1 ? "" : "er"}
                </div>
              </div>
              <Input
                value={values[r.raw_material_id] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [r.raw_material_id]: e.target.value }))}
                placeholder="f.eks. hvetemel"
                disabled={!canWrite}
                className="h-9 w-64"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!canWrite || busy === r.raw_material_id || !(values[r.raw_material_id] ?? "").trim()}
                onClick={() => saveOne(r.raw_material_id)}
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
      </Card>

      {composite.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 text-base font-semibold">Sammensatte råvarer</h3>
          <div className="divide-y divide-border">
            {composite.map((r) => (
              <div key={r.raw_material_id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</div>
                <Badge variant="outline">Sammensatt — deklareres via komponentene</Badge>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/ravarer/vareliste/${r.raw_material_id}`}>Åpne råvaren</Link>
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
