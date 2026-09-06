import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  useUpdateRawMaterial,
  type RawMaterialRow,
} from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BASE_UNITS, formatDate } from "@/ravarer/lib/constants";
import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";
import { categoryOptions } from "@/ravarer/lib/categories";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { RecalcHistory } from "@/ravarer/components/packages/RecalcHistory";
import { SetPackageDialog } from "@/ravarer/components/packages/SetPackageDialog";
import {
  usePackageWorklist,
  type PackageWorklistRow,
} from "@/ravarer/hooks/usePackageSizes";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";

/** Felt som redigeres i denne fanen. Lager styres i lagerkortet. */
const GRAIN_CLASSIFICATIONS = [
  { value: "sifted_flour", label: "Siktet mel" },
  { value: "whole_grain_flour", label: "Sammalt mel" },
  { value: "whole_grains", label: "Hele korn" },
  { value: "wheat_bran", label: "Kli" },
  { value: "other_flour", label: "Annet mel" },
  { value: "not_grain", label: "Ikke korn" },
] as const;

const CEREAL_TYPES = [
  "hvete",
  "rug",
  "havre",
  "spelt",
  "bygg",
  "mais",
  "ris",
] as const;

const EDITABLE_FIELDS = [
  "sku",
  "name",
  "declaration_name",
  "description",
  "category",
  "categories",
  "base_unit",
  "current_cost_price",
  "agreed_price",
  "is_active",
  "is_packaging",
  "primary_supplier_id",
  "grain_classification",
  "cereal_type",
  "water_content_pct",
  "unit_weight_grams",
] as const satisfies readonly (keyof RawMaterialRow)[];

type EditableField = (typeof EDITABLE_FIELDS)[number];

function changedFields(
  draft: RawMaterialRow,
  rm: RawMaterialRow,
): Partial<RawMaterialRow> {
  const patch: Partial<RawMaterialRow> = {};
  for (const key of EDITABLE_FIELDS) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(rm[key])) {
      (patch as Record<EditableField, unknown>)[key] = draft[key];
    }
  }
  return patch;
}

interface Props {
  rm: RawMaterialRow;
  /** Lar siden lagre fanen med ⌘S. */
  registerSave?: (save: () => void) => void;
}

export function OverviewTab({ rm, registerSave }: Props) {
  const { canWrite } = useRavarer();
  const update = useUpdateRawMaterial();
  const { data: suppliers = [] } = useSuppliers();
  const [draft, setDraft] = useState<RawMaterialRow>(rm);
  const patch = useMemo(() => changedFields(draft, rm), [draft, rm]);
  const dirty = Object.keys(patch).length > 0;

  // Resynk når råvaren er oppdatert et annet sted (f.eks. telling eller
  // pakningsomregning) — men aldri oppå ulagret arbeid.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setDraft(rm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rm.updated_at, rm.id]);

  const guard = useUnsavedChangesGuard(dirty);
  const [packageOpen, setPackageOpen] = useState(false);
  const { data: packageWorklist = [] } = usePackageWorklist();
  const packageRow = useMemo<PackageWorklistRow>(() => {
    const found = packageWorklist.find((r) => r.id === rm.id);
    if (found) return found;
    return {
      id: rm.id,
      legal_entity_id: rm.legal_entity_id,
      name: rm.name,
      base_unit: rm.base_unit,
      category: rm.category,
      current_cost_price: rm.current_cost_price,
      pakningsfaktor: rm.base_units_per_package,
      faktor_kilde: rm.package_confirmed_at ? "bekreftet" : null,
      bekreftet_dato: rm.package_confirmed_at,
      antall_fakturalinjer: null,
      antall_leverandorer: null,
      enheter_i_bruk: null,
      linjer_uten_pris: null,
      kjopt_kr_totalt: null,
      siste_faktura: null,
      pris_spredning: null,
      implisert_mengde: null,
      referansepris: null,
      referansekilde: null,
      referansedato: null,
    } as PackageWorklistRow;
  }, [packageWorklist, rm]);

  const save = async () => {
    if (!dirty) return;
    await update.mutateAsync({
      id: rm.id,
      ...patch,
      ...(patch.declaration_name !== undefined
        ? {
            declaration_name: draft.declaration_name?.trim()
              ? draft.declaration_name.trim()
              : null,
          }
        : {}),
    });
  };

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    registerSave?.(() => void saveRef.current());
  }, [registerSave]);

  const cats = draft.categories ?? [];
  const toggleCat = (c: string) =>
    setDraft((d) => {
      const list = d.categories ?? [];
      const next = list.includes(c)
        ? list.filter((x) => x !== c)
        : [...list, c];
      // Hold primær-kategori i synk: bruk første som primær hvis den ikke lenger er valgt
      const primary = next.includes(d.category ?? "")
        ? d.category
        : (next[0] ?? null);
      return { ...d, categories: next, category: primary };
    });

  return (
    <div className="space-y-5">
      <Card className="p-5 space-y-4">
        <h3 className="text-base font-semibold">Grunndata</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>SKU *</Label>
            <Input
              value={draft.sku}
              onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value }))}
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label>Primær kategori</Label>
            <Select
              value={draft.category ?? ""}
              onValueChange={(v) =>
                setDraft((d) => {
                  const list = d.categories ?? [];
                  const nextList = v && !list.includes(v) ? [...list, v] : list;
                  return { ...d, category: v || null, categories: nextList };
                })
              }
              disabled={!canWrite}
            >
              <SelectTrigger>
                <SelectValue placeholder="Velg" />
              </SelectTrigger>
              <SelectContent>
                <CategorySelectItems existing={[draft.category, ...cats]} />
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Flere kategorier</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {categoryOptions([draft.category, ...cats]).map((c) => {
              const active = cats.includes(c);
              const isPrimary = draft.category === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => canWrite && toggleCat(c)}
                  disabled={!canWrite}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    active
                      ? "border-app bg-app/10 text-app font-medium"
                      : "border-border bg-background text-ink-secondary hover:bg-muted"
                  } ${isPrimary ? "ring-1 ring-app" : ""} ${!canWrite ? "opacity-60 cursor-not-allowed" : ""}`}
                  title={isPrimary ? "Primær kategori" : undefined}
                >
                  {c}
                  {isPrimary ? " ★" : ""}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-ink-secondary">
            Stjerne markerer primær kategori (brukes for prisetoleranser).
          </p>
        </div>
        <div>
          <Label>Navn *</Label>
          <Input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>Deklarasjonsnavn</Label>
          <Input
            value={draft.declaration_name ?? ""}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                declaration_name: e.target.value === "" ? null : e.target.value,
              }))
            }
            disabled={!canWrite}
            placeholder="f.eks. hvetemel"
          />
          <p className="mt-1 text-xs text-ink-secondary">
            Navnet slik det skal stå i ingrediensdeklarasjonen, med små
            bokstaver (f.eks. hvetemel). Tomt = bruk råvarenavnet.
          </p>
        </div>
        <div>
          <Label>Beskrivelse</Label>
          <Textarea
            value={draft.description ?? ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
            disabled={!canWrite}
            rows={2}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Basisenhet *</Label>
            <Select
              value={draft.base_unit}
              onValueChange={(v) => setDraft((d) => ({ ...d, base_unit: v }))}
              disabled={!canWrite}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASE_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border p-3">
            <Label className="text-sm">Pakning</Label>
            <p className="mt-1 text-sm tabular-nums">
              {rm.package_size
                ? `${rm.package_size} ${rm.package_unit ?? ""}`
                : "Pakningsstørrelse mangler"}
              {rm.base_units_per_package != null && (
                <span className="text-ink-secondary">
                  {" "}
                  · {rm.base_units_per_package} {rm.base_unit} per pakning
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-ink-secondary">
              {rm.package_confirmed_at
                ? `Bekreftet ${formatDate(rm.package_confirmed_at)}`
                : "Ikke bekreftet"}
            </p>
            {canWrite && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setPackageOpen(true)}
              >
                Endre pakning
              </Button>
            )}
            <p className="mt-2 text-xs text-ink-secondary">
              Pakningen endres i dialogen, som viser forhåndsvisning av
              omregnede priser og kan angres.{" "}
              <Link to="/ravarer/pakninger" className="underline">
                Se alle pakninger
              </Link>
              .
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="text-sm">Aktiv</Label>
            <p className="text-xs text-ink-secondary">
              Inaktive råvarer skjules som standard
            </p>
          </div>
          <Switch
            checked={draft.is_active}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, is_active: v }))}
            disabled={!canWrite}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="text-sm">Emballasje</Label>
            <p className="text-xs text-ink-secondary">
              Skjuler næring og allergen-tab
            </p>
          </div>
          <Switch
            checked={draft.is_packaging}
            onCheckedChange={(v) =>
              setDraft((d) => ({ ...d, is_packaging: v }))
            }
            disabled={!canWrite}
          />
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="text-base font-semibold">Bakerifelt</h3>
        <p className="text-xs text-ink-secondary">
          Brukes av bakerprosent, brødskala og deigberegninger i Varer.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Kornklassifisering</Label>
            <Select
              value={draft.grain_classification ?? "_none"}
              onValueChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  grain_classification: v === "_none" ? null : v,
                }))
              }
              disabled={!canWrite}
            >
              <SelectTrigger>
                <SelectValue placeholder="Ikke satt" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Ikke satt</SelectItem>
                {GRAIN_CLASSIFICATIONS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-ink-secondary">
              Alt annet enn «ikke korn» teller som mel i bakerprosenten.
            </p>
          </div>
          <div>
            <Label>Kornslag</Label>
            <Select
              value={draft.cereal_type ?? "_none"}
              onValueChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  cereal_type: v === "_none" ? null : v,
                }))
              }
              disabled={!canWrite}
            >
              <SelectTrigger>
                <SelectValue placeholder="Ikke satt" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Ikke satt</SelectItem>
                {CEREAL_TYPES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-ink-secondary">
              Styrer nøkkelhullsvurdering og kornandel.
            </p>
          </div>
          <div>
            <Label>Vanninnhold (%)</Label>
            <Input
              type="number"
              step="0.1"
              value={draft.water_content_pct ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  water_content_pct:
                    e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              disabled={!canWrite}
            />
            <p className="mt-1 text-xs text-ink-secondary">
              Andel vann i råvaren, f.eks. 100 for vann.
            </p>
          </div>
          <div>
            <Label>Vekt per stk (gram)</Label>
            <Input
              type="number"
              step="1"
              value={draft.unit_weight_grams ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  unit_weight_grams:
                    e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              disabled={!canWrite}
            />
            <p className="mt-1 text-xs text-ink-secondary">
              Brukes når råvaren måles i stk.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="text-base font-semibold">Pris og leverandør</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Gjeldende kostpris (kr/{draft.base_unit})</Label>
            <Input
              type="number"
              step="0.01"
              value={draft.current_cost_price ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  current_cost_price:
                    e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              disabled={!canWrite}
            />
            <p className="mt-1 text-xs text-ink-secondary">
              Sist oppdatert: {formatDate(rm.price_updated_at)}{" "}
              {rm.price_source && `(${rm.price_source})`}
            </p>
          </div>
          <div>
            <Label>Avtalt pris (kr/{draft.base_unit})</Label>
            <Input
              type="number"
              step="0.01"
              value={draft.agreed_price ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  agreed_price:
                    e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              disabled={!canWrite}
            />
          </div>
        </div>
        <div>
          <Label>Primær leverandør</Label>
          <Select
            value={draft.primary_supplier_id ?? "_none"}
            onValueChange={(v) =>
              setDraft((d) => ({
                ...d,
                primary_supplier_id: v === "_none" ? null : v,
              }))
            }
            disabled={!canWrite}
          >
            <SelectTrigger>
              <SelectValue placeholder="Ingen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">Ingen</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h3 className="text-base font-semibold">Omregninger av kostpris</h3>
        <RecalcHistory rawMaterialId={rm.id} baseUnit={rm.base_unit} />
      </Card>

      {canWrite && (
        <div className="sticky bottom-4 flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={!dirty}
            onClick={() => setDraft(rm)}
          >
            Forkast
          </Button>
          <Button disabled={!dirty || update.isPending} onClick={save}>
            Lagre endringer
          </Button>
        </div>
      )}

      <SetPackageDialog
        row={packageRow}
        open={packageOpen}
        onOpenChange={setPackageOpen}
      />
      <UnsavedChangesDialog {...guard.dialogProps} />
    </div>
  );
}
