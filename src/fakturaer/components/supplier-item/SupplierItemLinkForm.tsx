import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useCompany } from "@/hooks/useCompany";
import { useMaterialById, useMaterialChoices } from "@/fakturaer/hooks/useMaterialChoices";
import { useLinkSupplierItem, usePackageInference } from "@/fakturaer/hooks/useSupplierItems";
import { MaterialBlock, type NewMaterialDraft } from "./MaterialBlock";
import { PackageBlock } from "./PackageBlock";
import { LinkResultBox } from "./LinkResultBox";
import { NOT_ITEM_REASONS, nameFromDescription, needsPackage, openScope, suggestedBaseUnit } from "@/fakturaer/lib/linkFormLogic";
import { parseDecimal } from "@/fakturaer/lib/units";
import type { LinkSupplierItemBody, LinkSupplierItemResult, SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";

interface Props {
  item: SupplierItem;
  lines: SupplierItemLine[];
  canWrite?: boolean;
  onDone?: (r: LinkSupplierItemResult) => void;
  onClose: () => void;
  onNext?: () => void;
}

const Block = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h3 className="text-sm font-semibold"><span className="mr-1.5 text-ink-secondary">{n}.</span>{title}</h3>
    {children}
  </section>
);

/** Én flate, tre blokker, én hovedknapp. */
export function SupplierItemLinkForm({ item, lines, canWrite = true, onDone, onClose, onNext }: Props) {
  const { data: company } = useCompany();
  const link = useLinkSupplierItem();
  const scope = openScope(lines);
  const refLine = scope.lastOpen ?? lines[0] ?? null;
  const refLineId = refLine?.id ?? item.last_open_line_id ?? item.last_line_id;

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedId, setSelectedId] = useState<string | null>(item.rm_id);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<NewMaterialDraft>({ name: nameFromDescription(item.description), itemType: "ravare", category: "", baseUnit: "stk", declarationName: "" });
  const [bupp, setBupp] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [editPkg, setEditPkg] = useState(false);
  const [primary, setPrimary] = useState(false);
  const [notItem, setNotItem] = useState<string | null>(null);
  const [touched, setTouched] = useState({ baseUnit: false, bupp: false, confirm: false });
  const [result, setResult] = useState<LinkSupplierItemResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { suggestions, results } = useMaterialChoices(item.rm_id ? null : refLineId, search);
  const selected = useMaterialById(mode === "existing" ? selectedId : null);
  const baseUnit = mode === "new" ? draft.baseUnit : selected.data?.base_unit ?? null;
  const inference = usePackageInference(refLineId, baseUnit);
  const baseGuess = usePackageInference(mode === "new" ? refLineId : null, null);

  // Grunnenhet for ny råvare forhåndsvelges fra varenavnet.
  useEffect(() => {
    if (baseGuess.data && !touched.baseUnit) setDraft((d) => ({ ...d, baseUnit: suggestedBaseUnit(baseGuess.data) }));
  }, [baseGuess.data, touched.baseUnit]);
  useEffect(() => {
    if (mode === "new") setPrimary(true);
  }, [mode]);
  useEffect(() => {
    const inf = inference.data;
    if (!inf || inf.direct) return;
    if (!touched.bupp) setBupp(inf.suggested_bupp != null ? String(inf.suggested_bupp).replace(".", ",") : "");
    if (!touched.confirm) setConfirm(inf.source === "regnestykke_og_varenavn");
  }, [inference.data, touched.bupp, touched.confirm]);

  const pkgNeeded = !inference.data?.direct && needsPackage(refLine?.unit, baseUnit);
  const sameRm = mode === "existing" && selectedId === item.rm_id;
  const existingPkg = sameRm && item.package_confirmed_at && item.base_units_per_package != null ? { bupp: item.base_units_per_package, confirmedAt: item.package_confirmed_at } : null;
  const buppNum = parseDecimal(bupp);
  const pkgValid = !pkgNeeded || (existingPkg && !editPkg) || (buppNum != null && buppNum > 0);
  const hasMaterial = mode === "new" ? draft.name.trim().length > 1 : !!selectedId;
  const n = scope.lines;

  if (result) return <LinkResultBox result={result} onClose={onClose} onNext={onNext} />;

  const submit = async (body: Partial<LinkSupplierItemBody>) => {
    if (!company) return;
    setError(null);
    try {
      const r = await link.mutateAsync({ legal_entity_id: company.id, supplier_id: item.supplier_id, item_key: item.item_key, ...body });
      setResult(r);
      onDone?.(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Koblingen kunne ikke lagres.");
    }
  };

  const onLink = () => {
    const body: Partial<LinkSupplierItemBody> = { set_primary: primary };
    if (mode === "new") {
      body.new_raw_material = {
        name: draft.name.trim(),
        base_unit: draft.baseUnit,
        item_type: draft.itemType,
        ...(draft.category ? { category: draft.category } : {}),
        ...(draft.declarationName.trim() ? { declaration_name: draft.declarationName.trim() } : {}),
      };
    } else if (selectedId) body.raw_material_id = selectedId;
    if (pkgNeeded && !(existingPkg && !editPkg) && buppNum != null) {
      body.package = { base_units_per_package: buppNum, package_unit: refLine?.unit ?? undefined, confirm };
    }
    void submit(body);
  };

  const disabled = !canWrite || link.isPending || !company;
  const materialLoading = mode === "existing" && !!selectedId && selected.isLoading;
  const onDraft = (d: NewMaterialDraft) => {
    if (d.baseUnit !== draft.baseUnit) setTouched((t) => ({ ...t, baseUnit: true }));
    setDraft(d);
  };

  return (
    <div className="space-y-5">
      <Block n={1} title="Hvilken råvare er dette?">
        <MaterialBlock
          idPrefix={`si-${item.item_key}`}
          mode={mode}
          onModeChange={setMode}
          selected={selected.data ?? null}
          selectedId={selectedId}
          onSelect={setSelectedId}
          suggestions={suggestions.data ?? []}
          results={results.data ?? []}
          searching={results.isFetching}
          search={search}
          onSearch={setSearch}
          draft={draft}
          onDraft={onDraft}
        />
      </Block>
      {pkgNeeded && baseUnit && (
        <Block n={2} title={`Hva inneholder én ${refLine?.unit ?? "pakning"}?`}>
          <PackageBlock
            idPrefix={`si-${item.item_key}`}
            baseUnit={baseUnit}
            packageUnit={refLine?.unit ?? "pakning"}
            value={bupp}
            onChange={(v) => { setTouched((t) => ({ ...t, bupp: true })); setBupp(v); }}
            confirm={confirm}
            onConfirm={(v) => { setTouched((t) => ({ ...t, confirm: true })); setConfirm(v); }}
            inference={inference.data}
            loading={inference.isFetching}
            existing={existingPkg}
            editing={editPkg}
            onEdit={() => setEditPkg(true)}
          />
        </Block>
      )}
      <Block n={pkgNeeded && baseUnit ? 3 : 2} title="Gjelder">
        <p className="text-sm">{n} åpne {n === 1 ? "linje" : "linjer"} på {scope.invoices} {scope.invoices === 1 ? "faktura" : "fakturaer"}</p>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={primary} onCheckedChange={(v) => setPrimary(v === true)} />
          Sett som primær leverandør for råvaren
        </label>
      </Block>

      {!canWrite && <p className="text-caption text-ink-secondary">Du har bare lesetilgang.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
        <Button type="button" onClick={onLink} disabled={disabled || materialLoading || !hasMaterial || !pkgValid}>
          {link.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
          {mode === "new" ? `Opprett råvare og koble ${n} ${n === 1 ? "linje" : "linjer"}` : `Koble og regn om ${n} ${n === 1 ? "linje" : "linjer"}`}
        </Button>
        {notItem == null && (
          <button type="button" className="text-sm text-ink-secondary underline underline-offset-2" onClick={() => setNotItem("")} disabled={disabled}>
            Dette er ikke en vare
          </button>
        )}
      </div>
      {notItem != null && (
        <div className="space-y-2 rounded-md border border-line-subtle p-3">
          <p className="text-sm font-medium">Hvorfor er dette ikke en vare?</p>
          <div className="flex flex-wrap gap-1.5">
            {NOT_ITEM_REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={notItem === r} onClick={() => setNotItem(r)} className={`rounded-full border px-3 py-1 text-sm ${notItem === r ? "border-primary bg-primary/10 text-primary" : "border-line-subtle"}`}>
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={disabled || !notItem} onClick={() => void submit({ not_raw_material: true, reason: notItem ?? undefined })}>
              Merk som ikke vare
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setNotItem(null)}>Avbryt</Button>
          </div>
        </div>
      )}
    </div>
  );
}
