import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ITEM_TYPES } from "@/ravarer/lib/itemTypes";
import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";
import { PackageFields } from "./PackageFields";
import { CREATE_BASE_UNITS, isCreateBaseUnit, type AiConfidence, type CreateDraft } from "./createSheetLogic";

const NONE = "_none";

function AiTag({ level }: { level?: AiConfidence | null }) {
  if (level === undefined) return null;
  return (
    <span className="ml-2 rounded-full border border-border px-1.5 text-caption text-muted-foreground">
      {level ? `Fra datablad · ${level} sikkerhet` : "Fra datablad"}
    </span>
  );
}

interface Props {
  draft: CreateDraft;
  set: (patch: Partial<CreateDraft>) => void;
  suppliers: { id: string; name: string }[];
  /** Vis AI-merking per felt (datablad-modus). `null` = fra datablad uten kjent sikkerhet. */
  ai?: { name?: AiConfidence | null; sku?: AiConfidence | null; package?: AiConfidence | null };
  baseUnitHint?: string | null;
  showSupplier: boolean;
}

/** Feltene i RawMaterialCreateSheet. */
export function CreateSheetFields({ draft, set, suppliers, ai, baseUnitHint, showSupplier }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="rcs-name">Navn *<AiTag level={ai?.name} /></Label>
        <Input id="rcs-name" autoFocus value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="f.eks. Hvetemel siktet" />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Varetype</legend>
        <div className="grid grid-cols-2 gap-2">
          {ITEM_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={draft.itemType === t.value}
              onClick={() => set({ itemType: t.value })}
              className={cn(
                "rounded-lg border p-2 text-left text-sm transition",
                draft.itemType === t.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
              )}
            >
              <span className="font-medium">{t.label}</span>
              <span className="block text-caption text-muted-foreground">{t.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Kategori</Label>
          <Select value={draft.category || NONE} onValueChange={(v) => set({ category: v === NONE ? "" : v })}>
            <SelectTrigger aria-label="Kategori"><SelectValue placeholder="Ingen" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Ingen kategori</SelectItem>
              <CategorySelectItems existing={[draft.category]} />
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Grunnenhet *</Label>
          <Select value={draft.baseUnit} onValueChange={(v) => { if (isCreateBaseUnit(v)) set({ baseUnit: v }); }}>
            <SelectTrigger aria-label="Grunnenhet"><SelectValue /></SelectTrigger>
            <SelectContent>{CREATE_BASE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
          </Select>
          {baseUnitHint && <p className="mt-1 text-caption text-muted-foreground">{baseUnitHint}</p>}
        </div>
      </div>
      <div className="rounded-lg border p-3">
        <p className="mb-2 text-sm font-medium">Pakning (valgfritt)<AiTag level={ai?.package} /></p>
        <PackageFields
          baseUnit={draft.baseUnit}
          units={draft.units}
          onUnitsChange={(v) => set({ units: v })}
          packageUnit={draft.packageUnit}
          onPackageUnitChange={(v) => set({ packageUnit: v })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="rcs-decl">Deklarasjonsnavn</Label>
          <Input id="rcs-decl" value={draft.declarationName} onChange={(e) => set({ declarationName: e.target.value })} placeholder="f.eks. hvetemel" />
        </div>
        <div>
          <Label htmlFor="rcs-sku">Varenummer<AiTag level={ai?.sku} /></Label>
          <Input id="rcs-sku" value={draft.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="Lages fra navnet" />
        </div>
      </div>
      {showSupplier && (
        <div>
          <Label>Primærleverandør</Label>
          <Select value={draft.primarySupplierId ?? NONE} onValueChange={(v) => set({ primarySupplierId: v === NONE ? null : v })}>
            <SelectTrigger aria-label="Primærleverandør"><SelectValue placeholder="Ingen" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Ingen</SelectItem>
              {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
