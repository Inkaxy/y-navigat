import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { paths } from "@/ravarer/lib/paths";
import { DeclarationNameField } from "@/ravarer/editors/DeclarationNameField";

function initialFor(r: DeclarationWorklistRow) {
  return (r.matvaretabellen_name ?? r.suggested_name ?? "").trim().toLowerCase();
}

export default function Deklarasjonsnavn() {
  const { legalEntityId, canWrite } = useRavarer();
  const { data: rows = [], isLoading } = useDeclarationWorklist(legalEntityId);
  const save = useSaveDeclarationName();
  const [savingAll, setSavingAll] = useState(false);

  const simple = useMemo(() => rows.filter((r) => !r.is_composite), [rows]);
  const composite = useMemo(() => rows.filter((r) => r.is_composite), [rows]);
  const prefilled = useMemo(
    () => simple.filter((r) => initialFor(r).length > 0),
    [simple],
  );

  async function saveAll() {
    setSavingAll(true);
    let ok = 0;
    let failed = 0;
    for (const r of prefilled) {
      const v = initialFor(r);
      try {
        await save.mutateAsync({ rawMaterialId: r.raw_material_id, declarationName: v, silent: true });
        ok++;
      } catch {
        failed++;
      }
    }
    setSavingAll(false);
    if (failed === 0) toast.success(`${ok} deklarasjonsnavn lagret`);
    else toast.warning(`${ok} lagret, ${failed} feilet`);
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
          {canWrite && prefilled.length > 0 && (
            <Button size="sm" onClick={saveAll} disabled={savingAll}>
              {savingAll ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              Lagre alle utfylte ({prefilled.length})
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
                <Link to={paths.raavare(r.raw_material_id)} className="truncate text-sm font-medium hover:underline">
                  {r.name}
                </Link>
                <div className="text-xs tabular-nums text-ink-secondary">
                  Brukes i {r.recipes_using} oppskrift{r.recipes_using === 1 ? "" : "er"}
                </div>
              </div>
              <DeclarationNameField
                rawMaterialId={r.raw_material_id}
                value={initialFor(r)}
                rawMaterialName={r.name}
                matvaretabellenName={r.matvaretabellen_name}
                disabled={!canWrite}
                compact
              />
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
                  <Link to={paths.raavare(r.raw_material_id)}>Åpne råvaren</Link>
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
