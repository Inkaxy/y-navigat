import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Maximize2, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useDeclarationWorklist, useSaveDeclarationName, type DeclarationWorklistRow } from "@/ravarer/hooks/useDeclarationNames";
import { DeclarationNameField } from "@/ravarer/editors/DeclarationNameField";
import { paths } from "@/ravarer/lib/paths";
import { sectionSearch } from "@/ravarer/lib/rawMaterialSections";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { PeekPanel, SplitView } from "@/ravarer/ui/SplitView";
import { orderDeclarationRows } from "./modeLogic";
import { useActiveRow } from "./useActive";

export function initialDeclarationFor(r: DeclarationWorklistRow): string {
  return (r.matvaretabellen_name ?? r.suggested_name ?? "").trim().toLowerCase();
}

/** Ulagret = utkast som avviker fra forslaget, på en enkel (ikke sammensatt) rad som fortsatt står i listen. */
export function declarationDirty(rows: readonly DeclarationWorklistRow[], drafts: Readonly<Record<string, string>>): boolean {
  return rows.some((r) => !r.is_composite && drafts[r.raw_material_id] != null && drafts[r.raw_material_id].trim() !== initialDeclarationFor(r));
}

/**
 * Deklarasjon-modus (`liste=deklarasjon`). Samme felt og skrivevei (`DeclarationNameField` /
 * `useSaveDeclarationName`) som før; utkast løftet hit for «Lagre alle utfylte» med delvis-feil-melding,
 * og ulagrede utkast beskyttes ved listebytte, lenker, tilbake og lukking.
 */
export default function DeclarationMode() {
  const { legalEntityId, canWrite } = useRavarer();
  const list = useDeclarationWorklist(legalEntityId);
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const save = useSaveDeclarationName();
  const { sp, valgt, setActive, listSearch } = useActiveRow();
  const [savingAll, setSavingAll] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftFor = (r: DeclarationWorklistRow) => drafts[r.raw_material_id] ?? initialDeclarationFor(r);
  const setDraft = (id: string, v: string) => setDrafts((d) => ({ ...d, [id]: v }));

  const q = sp.get("q") ?? "";
  const simple = useMemo(() => orderDeclarationRows(rows.filter((r) => !r.is_composite), q), [rows, q]);
  const composite = useMemo(() => orderDeclarationRows(rows.filter((r) => r.is_composite), q), [rows, q]);
  const prefilled = simple.filter((r) => draftFor(r).trim().length > 0);

  const guard = useUnsavedChangesGuard(canWrite && declarationDirty(rows, drafts));

  async function saveAll() {
    // Frys utvalget: nøyaktig de utfylte radene som vises nå.
    const batch = prefilled.map((r) => ({ id: r.raw_material_id, value: draftFor(r).trim() }));
    setSavingAll(true);
    let ok = 0;
    const failed: string[] = [];
    for (const b of batch) {
      try {
        await save.mutateAsync({ rawMaterialId: b.id, declarationName: b.value, silent: true });
        ok++;
        // Fjern bare nøyaktig det innsendte utkastet. Et nyere lokalt utkast beholdes (og er fortsatt ulagret).
        setDrafts((d) => {
          if (d[b.id] === undefined || d[b.id].trim() !== b.value) return d;
          const n = { ...d }; delete n[b.id]; return n;
        });
      } catch (e) {
        console.error("[deklarasjonsnavn:lagre-alle]", e);
        failed.push(b.id);
      }
    }
    setSavingAll(false);
    if (failed.length === 0) toast.success(`${ok} deklarasjonsnavn lagret`);
    else toast.warning(`${ok} lagret, ${failed.length} feilet — utkastene for de feilede er beholdt`);
  }

  const active = rows.find((r) => r.raw_material_id === valgt) ?? null;
  const columns: Column<DeclarationWorklistRow>[] = [
    { id: "name", header: "Råvare", alwaysVisible: true, csv: (r) => r.name,
      cell: (r) => <div className="min-w-0"><div className="truncate font-medium">{r.name}</div>{r.matvaretabellen_name && <div className="text-xs text-ink-secondary">Matvaretabellen: {r.matvaretabellen_name}</div>}</div> },
    { id: "recipes_using", header: "Oppskrifter", align: "right", csv: (r) => String(r.recipes_using), cell: (r) => r.recipes_using },
    { id: "draft", header: "Deklarasjonsnavn", csv: (r) => draftFor(r),
      cell: (r) => (
        <DeclarationNameField rawMaterialId={r.raw_material_id} value={null} initialDraft={initialDeclarationFor(r)} draft={draftFor(r)}
          onDraftChange={(v) => setDraft(r.raw_material_id, v)} rawMaterialName={r.name} matvaretabellenName={r.matvaretabellen_name} disabled={!canWrite || savingAll} compact />
      ) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-secondary">Råvarer i bruk som mangler lovlig ingrediensnavn. Tyngst brukt først. {list.isLoading ? "" : `${simple.length} mangler navn.`}</p>
        {canWrite && prefilled.length > 0 && (
          <Button size="sm" onClick={() => void saveAll()} disabled={savingAll}>
            {savingAll ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1.5 h-4 w-4" aria-hidden />}
            Lagre alle utfylte ({prefilled.length})
          </Button>
        )}
      </div>
      <SplitView
        selected={!!valgt}
        list={
          <DataTable
            ariaLabel="Deklarasjonsnavn"
            rows={list.isLoading ? undefined : simple}
            columns={columns}
            getId={(r) => r.raw_material_id}
            isLoading={list.isLoading}
            error={list.isError ? list.error : undefined}
            onRetry={() => void list.refetch()}
            emptyText="Alle råvarer i bruk har deklarasjonsnavn."
            activeId={valgt}
            onActiveChange={(id) => setActive(id)}
            hotkeys
            renderMobileCard={(r) => (
              <div className="rounded-lg border border-border p-3">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-ink-secondary">Brukes i {r.recipes_using} oppskrift{r.recipes_using === 1 ? "" : "er"}{drafts[r.raw_material_id] != null ? " · ulagret utkast" : ""}</div>
              </div>
            )}
          />
        }
        panel={
          <PeekPanel title={active?.name} fullHref={active ? `${paths.raavare(active.raw_material_id)}${sectionSearch(new URLSearchParams(listSearch), "deklarasjon")}` : undefined} onClose={valgt ? () => setActive(null) : undefined} emptyText="Velg en råvare i listen">
            {active ? (
              <div className="space-y-4">
                <p className="text-sm text-ink-secondary">Brukes i {active.recipes_using} oppskrift{active.recipes_using === 1 ? "" : "er"}{active.matvaretabellen_name ? ` · Matvaretabellen: ${active.matvaretabellen_name}` : ""}</p>
                {active.is_composite ? (
                  <Badge variant="outline">Sammensatt — deklareres via komponentene</Badge>
                ) : (
                  <DeclarationNameField rawMaterialId={active.raw_material_id} value={null} initialDraft={initialDeclarationFor(active)} draft={draftFor(active)}
                    onDraftChange={(v) => setDraft(active.raw_material_id, v)} rawMaterialName={active.name} matvaretabellenName={active.matvaretabellen_name} disabled={!canWrite || savingAll} />
                )}
                <Link className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2" to={`${paths.raavare(active.raw_material_id)}${sectionSearch(new URLSearchParams(listSearch), "deklarasjon")}`}><Maximize2 className="h-3.5 w-3.5" aria-hidden />Åpne deklarasjon på råvarekortet</Link>
              </div>
            ) : null}
          </PeekPanel>
        }
      />
      {composite.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-base font-semibold">Sammensatte råvarer</h3>
          <ul className="divide-y divide-border">
            {composite.map((r) => (
              <li key={r.raw_material_id} className="flex flex-wrap items-center gap-3 py-3">
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" onClick={() => setActive(r.raw_material_id)}>{r.name}</button>
                <Badge variant="outline">Sammensatt — deklareres via komponentene</Badge>
                <Button asChild size="sm" variant="outline"><Link to={paths.raavare(r.raw_material_id)}>Åpne råvaren</Link></Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <UnsavedChangesDialog {...guard.dialogProps} />
    </div>
  );
}
