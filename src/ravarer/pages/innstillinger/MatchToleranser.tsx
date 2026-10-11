import { Link } from "react-router-dom";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { QueryState } from "@/components/common/QueryState";
import { StartPriceCandidatesCard } from "@/fakturaer/components/StartPriceCandidatesCard";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { TieredPriceSettings } from "./TieredPriceSettings";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { usePriceSettingsDraft, type SaveResult } from "@/ravarer/hooks/usePriceSettingsDraft";
import { useCategoryUsage } from "@/ravarer/lib/categoryUsage";
import { ENGINE_DEFAULTS, type PriceDraft } from "@/ravarer/lib/priceSettingsDraft";
import { paths } from "@/ravarer/lib/paths";

/**
 * Priskontroll-innstillinger: prisavvik, matching, startpris og kategoritoleranser i ÉN kladd med felles
 * «Lagre endringer»/«Avbryt». Ingen feltendring skriver før Lagre. Startpriskandidater og omberegning er egne handlinger.
 */
export default function MatchToleranserPage() {
  const { legalEntityId, canWrite, accessLevel } = useRavarer();
  const canEdit = canWrite && (accessLevel === "approve" || accessLevel === "admin");
  const m = usePriceSettingsDraft(legalEntityId, canEdit);
  const guard = useUnsavedChangesGuard(m.dirty || m.saving, m.cancel);
  const cats = useCategoryUsage(legalEntityId);
  const dis = !canEdit || m.saving || m.status !== "ready";

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner title="Match-toleranser" subtitle="Én kilde for prisavvik og automatisk matching av fakturalinjer" />

      {m.status !== "ready" ? (
        <QueryState scope="Priskontroll-innstillinger" isLoading={m.status === "loading"} isError={m.status === "error"} error={m.readError}
          onRetry={m.retry} isEmpty={false}>{null}</QueryState>
      ) : m.draft && (
        <>
          {m.settingsAbsent && (
            <p role="note" className="rounded-md border border-border bg-muted/40 p-2 text-caption">
              Selskapet har ingen lagrede innstillinger ennå. Feltene viser standardverdiene som gjelder nå; ingenting lagres før du trykker «Lagre endringer».
            </p>
          )}
          <TieredPriceSettings draft={m.draft} update={m.update} disabled={dis} legalEntityId={legalEntityId} canWrite={canEdit} />
          <MatchingCard d={m.draft} update={m.update} disabled={dis} />
          <StartPriceCard d={m.draft} update={m.update} disabled={dis} />
          <CategoryCard d={m.draft} update={m.update} disabled={dis} baseRows={m.baseRows} cats={cats} />
          {m.errors.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-md border border-destructive/40 p-2 text-caption text-destructive">
              {m.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          <ResultPanel result={m.result} needsReread={m.needsReread} onReread={() => void m.reread()} />
          {canEdit && (
            <SettingsSaveBar dirty={m.dirty} saving={m.saving} canSave={m.canSave} onSave={m.save} onCancel={m.cancel}
              status={m.needsReread ? <span className="text-destructive">Les innstillingene på nytt før du lagrer igjen.</span> : undefined} />
          )}
        </>
      )}

      {/* Egen, eksplisitt handling med egen bekreftelse — ikke en del av kladden. */}
      <StartPriceCandidatesCard legalEntityId={legalEntityId} canWrite={canEdit} />
      <UnsavedChangesDialog {...guard.dialogProps} />
    </div>
  );
}

function ResultPanel({ result, needsReread, onReread }: { result: SaveResult | null; needsReread: boolean; onReread: () => void }) {
  if (!result && !needsReread) return null;
  if (result?.kind === "saved") return <p role="status" className="text-sm text-success">Alle endringer er lagret.</p>;
  if (result?.kind === "stale") return <p role="status" className="text-sm text-ink-secondary">Lagringen gjaldt et annet selskap og vises ikke her.</p>;
  return (
    <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
      {result && (
        <>
          <p className="font-medium text-destructive">{result.kind === "partial" ? "Bare noe ble lagret." : "Ingenting ble bekreftet lagret."}</p>
          <ul className="space-y-0.5 text-caption">
            {result.steps.map((s) => <li key={s.label} className={s.ok ? "text-success" : "text-destructive"}>{s.ok ? "Lagret" : "Feilet eller ukjent"}: {s.label}</li>)}
          </ul>
          <p className="text-caption text-ink-secondary">Kladden for det som ikke ble lagret, er beholdt. Neste lagring sender bare det som fortsatt avviker fra det som faktisk er lagret.</p>
        </>
      )}
      {needsReread && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption text-destructive">Kunne ikke lese lagret tilstand etter lagringen.</span>
          <Button type="button" variant="outline" className="min-h-[44px] md:min-h-9" onClick={onReread}>Les på nytt</Button>
        </div>
      )}
    </div>
  );
}

type CardProps = { d: PriceDraft; update: (p: Partial<PriceDraft>) => void; disabled: boolean };

function MatchingCard({ d, update, disabled }: CardProps) {
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-title text-sm font-semibold">Matching og automatikk</h2>
        <p className="text-caption text-ink-secondary">
          Hvor likt et fakturanavn må være en vare før det foreslås eller kobles. Automatisk godkjenning bruker toleransen over (eller kategoritoleransen).
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <NumField id="m-fuzzy" label="Terskel for forslag (0–1)" hint={`Tomt = standard ${ENGINE_DEFAULTS.fuzzy}`.replace(".", ",")} value={d.fuzzy} disabled={disabled} onChange={(v) => update({ fuzzy: v })} />
        <NumField id="m-auto" label="Terskel for automatisk kobling (0–1)" hint={`Tomt = standard ${ENGINE_DEFAULTS.fuzzyAuto}`.replace(".", ",")} value={d.fuzzyAuto} disabled={disabled} onChange={(v) => update({ fuzzyAuto: v })} />
        <NumField id="m-dom" label="Krav om klar vinner (0–1)" hint={`Beste forslag må slå nest beste med minst dette. Tomt = standard ${ENGINE_DEFAULTS.dominance}`.replace(".", ",")} value={d.dominance} disabled={disabled} onChange={(v) => update({ dominance: v })} />
      </div>
      <div className="space-y-1 border-t border-line-subtle pt-3">
        <ToggleRow label="Godkjenn automatisk innenfor toleranse" hint="Linjer med prisavvik under toleransen markeres ikke for gjennomgang." checked={d.autoApprove} disabled={disabled} onChange={(v) => update({ autoApprove: v })} />
        <ToggleRow label="Godkjenn automatisk mot tidligere registrert pris"
          hint="Automatisk koblede linjer med samme pris som forrige registrerte kjøp (innenfor toleransen) blir ferdig kontrollert. Avvik over toleransen blir alltid liggende. Attestering og betaling er fortsatt en egen handling."
          checked={d.lastPurchase} disabled={disabled} onChange={(v) => update({ lastPurchase: v })} />
      </div>
    </Card>
  );
}

function StartPriceCard({ d, update, disabled }: CardProps) {
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-title text-sm font-semibold">Startpris</h2>
        <p className="text-caption text-ink-secondary">
          Startprisen er den første kjøpsprisen et menneske har kontrollert og bekreftet hos en leverandør. En gyldig avtalepris går alltid foran,
          og startpris blir aldri automatisk avtalepris. Grensene under gjelder bare linjer som måles mot startpris; ellers gjelder toleransen øverst.
        </p>
      </div>
      <div className="space-y-1">
        <ToggleRow label="Bruk første bekreftede kjøpspris som startpris" hint="Køen tilbyr «Bekreft startpris» der vare, pakning og nettopris er kontrollert. Ingenting lagres uten at du bekrefter."
          checked={d.useFirstStart} disabled={disabled} onChange={(v) => update({ useFirstStart: v })} />
        <ToggleRow label="Tillat automatisk linjekontroll mot startpris" hint="Av: hver linje mot startpris kontrolleres manuelt. På: linjer innenfor grensene under kan bli ferdig kontrollert uten trykk."
          checked={d.autoCheckStart} disabled={disabled} onChange={(v) => update({ autoCheckStart: v })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumField id="s-tol" label="Toleranse mot startpris (%)" hint="Avvik over denne grensen går alltid til gjennomgang." value={d.startTol} disabled={disabled} onChange={(v) => update({ startTol: v })} />
        <NumField id="s-max" label="Maksimal kronepåvirkning (kr)" hint="Valgfritt. Større avvik i kroner går til gjennomgang selv om prosenten er innenfor. Tomt eller 0 = ingen kronegrense." value={d.startMaxImpact} disabled={disabled} onChange={(v) => update({ startMaxImpact: v })} />
      </div>
    </Card>
  );
}

function CategoryCard({ d, update, disabled, baseRows, cats }: CardProps & {
  baseRows: { category: string }[];
  cats: ReturnType<typeof useCategoryUsage>;
}) {
  const used = new Set(d.cats.map((c) => c.category));
  const removed = baseRows.filter((r) => !used.has(r.category));
  const options = (cats.data?.categories ?? []).map((c) => c.category).filter((c) => !used.has(c));
  const setCat = (i: number, patch: Partial<PriceDraft["cats"][number]>) => update({ cats: d.cats.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-title text-sm font-semibold">Toleranse per kategori</h2>
        <p className="text-caption text-ink-secondary">Erstatter toleransen øverst for varer i kategorien. Maksgrensen og minste kronevirkning gjelder fortsatt.</p>
      </div>
      <ul className="divide-y divide-line-subtle">
        {d.cats.map((c, i) => (
          <li key={`${c.category}-${i}`} className="flex flex-wrap items-center gap-2 py-2">
            {baseRows.some((r) => r.category === c.category) ? (
              <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{c.category}</span>
            ) : (
              <div className="min-w-[12rem] flex-1">
                <Select value={c.category || undefined} onValueChange={(v) => setCat(i, { category: v })} disabled={disabled}>
                  <SelectTrigger className="min-h-[44px] md:min-h-9" aria-label="Velg kategori"><SelectValue placeholder="Velg kategori" /></SelectTrigger>
                  <SelectContent>
                    {[...(c.category ? [c.category] : []), ...options].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Input aria-label={`Toleranse % for ${c.category || "ny kategori"}`} inputMode="decimal" className="min-h-[44px] w-28 tabular-nums md:min-h-9" value={c.pct} disabled={disabled} onChange={(e) => setCat(i, { pct: e.target.value })} />
            <span className="text-caption text-ink-secondary">%</span>
            <Button type="button" size="icon" variant="ghost" className="h-[44px] w-[44px] md:h-9 md:w-9" disabled={disabled} aria-label={`Fjern toleranse for ${c.category || "ny kategori"}`}
              onClick={() => update({ cats: d.cats.filter((_, j) => j !== i) })}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
        {d.cats.length === 0 && <li className="py-3 text-sm text-ink-secondary">Ingen kategorier har egen toleranse.</li>}
      </ul>
      {removed.length > 0 && (
        <div className="space-y-1 rounded-md bg-muted/40 p-2 text-caption">
          <p>Fjernes ved lagring (faller tilbake på toleransen øverst):</p>
          <ul className="flex flex-wrap gap-2">
            {removed.map((r) => (
              <li key={r.category}>
                <Button type="button" size="sm" variant="outline" className="min-h-[44px] md:min-h-8" disabled={disabled}
                  onClick={() => {
                    const orig = baseRows.find((b) => b.category === r.category);
                    if (orig && "price_tolerance_pct" in orig) update({ cats: [...d.cats, { category: r.category, pct: String(orig.price_tolerance_pct).replace(".", ",") }] });
                  }}>
                  <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden />Angre «{r.category}»
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="min-h-[44px] md:min-h-9" disabled={disabled || cats.isError || cats.isLoading}
          onClick={() => update({ cats: [...d.cats, { category: "", pct: "5" }] })}>
          <Plus className="mr-1 h-4 w-4" aria-hidden />Legg til kategoritoleranse
        </Button>
        {cats.isLoading && <span className="text-caption text-ink-secondary">Henter kategorier …</span>}
        {cats.isError && (
          <span role="alert" className="text-caption text-destructive">
            Kunne ikke hente kategoriene. <button type="button" className="underline" onClick={() => void cats.refetch()}>Prøv igjen</button>
          </span>
        )}
        <Link to={paths.innstillinger({ seksjon: "kategorier" })} className="text-caption text-primary hover:underline">Se kategorioversikten</Link>
      </div>
    </Card>
  );
}

function NumField({ id, label, hint, value, disabled, onChange }: { id: string; label: string; hint: string; value: string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} inputMode="decimal" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="min-h-[44px] tabular-nums md:min-h-9" />
      <p className="text-caption text-ink-secondary">{hint}</p>
    </div>
  );
}

function ToggleRow({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-[44px] items-start justify-between gap-4 py-1">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-caption text-ink-secondary">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
