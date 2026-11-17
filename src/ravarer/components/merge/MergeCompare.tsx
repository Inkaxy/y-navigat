import { Fragment } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNok } from "@/ravarer/lib/constants";
import { ITEM_TYPE_TEXT, KEEP_REASON_TEXT, type KeepReason, type MergeFacts } from "@/ravarer/lib/merge/facts";
import { cn } from "@/lib/utils";

const n = (v: number) => v.toLocaleString("nb-NO");
const costText = (f: MergeFacts) => f.cost == null ? "Mangler" : `${formatNok(f.cost)}/${f.base_unit}${f.cost_status === "verifisert" ? "" : " (ikke verifisert)"}`;

function usage(f: MergeFacts): string {
  const parts = [
    f.recipes > 0 && `${n(f.recipes)} oppskrift${f.recipes === 1 ? "" : "er"}`,
    f.calc_additions > 0 && `${n(f.calc_additions)} kalkyletillegg`,
    f.price_lists > 0 && `${n(f.price_lists)} prisliste${f.price_lists === 1 ? "" : "r"}`,
    f.products > 0 && f.price_lists === 0 && `${n(f.products)} handelsvarekobling${f.products === 1 ? "" : "er"}`,
    (f.stock_movements > 0 || f.count_templates > 0 || f.stock_tracking) && `lager${f.current_stock != null ? ` (${n(f.current_stock)} ${f.base_unit})` : ""}`,
  ].filter((x): x is string => !!x);
  return parts.length ? parts.join(", ") : "Ikke i bruk";
}

export type FieldChoice = { name: string; category: string; item_type: string };

/** Varene side om side: velg hvilken som beholdes, og hvilket navn/kategori/type den skal ha. */
export function MergeCompare({ items, keepId, onKeep, suggested, fields, onFields, disabled }: {
  items: MergeFacts[]; keepId: string; onKeep: (id: string) => void; suggested: { id: string; reason: KeepReason } | null;
  fields: FieldChoice; onFields: (f: FieldChoice) => void; disabled: boolean;
}) {
  const rows: [string, (f: MergeFacts) => string][] = [
    ["Type", (f) => ITEM_TYPE_TEXT[f.item_type] ?? f.item_type],
    ["Kategori", (f) => f.category ?? "Uten kategori"],
    ["Grunnenhet", (f) => f.base_unit],
    ["Kostpris", costText],
    ["Leverandører", (f) => f.suppliers.length ? f.suppliers.map((s) => `${s.supplier_name}${s.sku ? ` ${s.sku}` : ""}${s.sku_aliases.length ? ` (+${s.sku_aliases.join(", ")})` : ""}`).join(" · ") : "Ingen"],
    ["Fakturalinjer", (f) => n(f.invoice_lines)],
    ["Brukes i", usage],
  ];
  const pickerFor = (key: keyof FieldChoice, label: string, value: (f: MergeFacts) => string) => {
    const opts = [...new Map(items.map((f) => [value(f), f.id])).entries()];
    if (opts.length < 2) return null;
    return (
      <div className="space-y-1">
        <Label htmlFor={`merge-${key}`}>{label}</Label>
        <Select value={fields[key]} onValueChange={(id) => onFields({ ...fields, [key]: id })} disabled={disabled}>
          <SelectTrigger id={`merge-${key}`} className="min-h-[44px]"><SelectValue /></SelectTrigger>
          <SelectContent>{opts.map(([text, id]) => <SelectItem key={id} value={id}>{text}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    );
  };
  const pickers = [
    pickerFor("name", "Navn", (f) => f.name),
    pickerFor("category", "Kategori", (f) => f.category ?? "Uten kategori"),
    pickerFor("item_type", "Type", (f) => ITEM_TYPE_TEXT[f.item_type] ?? f.item_type),
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <RadioGroup value={keepId} onValueChange={onKeep} disabled={disabled} aria-label="Varen som beholdes" className="grid gap-3 md:grid-cols-2">
        {items.map((f) => {
          const on = f.id === keepId;
          return (
            <label key={f.id} htmlFor={`keep-${f.id}`} className={cn("block cursor-pointer rounded-xl border p-3", on ? "border-primary bg-primary/5" : "border-line-subtle bg-card")}>
              <span className="flex items-start gap-2">
                <RadioGroupItem id={`keep-${f.id}`} value={f.id} className="mt-1" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{f.name}</span>
                  <span className="block text-caption text-ink-secondary">
                    {on ? "Beholdes" : "Slås inn i den som beholdes"}
                    {suggested?.id === f.id && ` · Forslag: ${KEEP_REASON_TEXT[suggested.reason]}`}
                  </span>
                </span>
              </span>
              <dl className="mt-2 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-caption">
                {rows.map(([label, fn]) => (<Fragment key={label}><dt className="text-ink-secondary">{label}</dt><dd className="min-w-0 break-words">{fn(f)}</dd></Fragment>))}
              </dl>
              {(f.has_nutrition || f.allergens > 0 || f.datasheets > 0) && (
                <p className="mt-1 text-caption text-ink-secondary">
                  Har {[f.has_nutrition && "næringsinnhold", f.allergens > 0 && "allergener", f.datasheets > 0 && "datablad"].filter(Boolean).join(", ")}
                </p>
              )}
            </label>
          );
        })}
      </RadioGroup>
      {pickers.length > 0 && (
        <div className="space-y-2">
          <p className="text-caption text-ink-secondary">Velg hva varen som beholdes skal hete og være. Deklarasjon, allergener og datablad hentes bare der den beholdte mangler dem.</p>
          <div className="grid gap-3 sm:grid-cols-3">{pickers}</div>
        </div>
      )}
    </div>
  );
}
