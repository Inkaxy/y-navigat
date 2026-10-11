import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { lineEdited, type PdfLine } from "@/fakturaer/lib/manualPdfSave";

type NumKey = "quantity" | "unit_price" | "total_amount" | "vat_rate" | "package_size" | "count_per_package";
type TextKey = "sku" | "unit" | "package_unit";

const NUM_FIELDS: { key: NumKey; label: string; step: string; hint?: string }[] = [
  { key: "quantity", label: "Antall", step: "0.001" },
  { key: "unit_price", label: "Stk.pris", step: "0.01" },
  { key: "total_amount", label: "Sum", step: "0.01" },
  { key: "vat_rate", label: "Mva %", step: "0.1" },
  { key: "package_size", label: "Pk.str", step: "0.001", hint: "Størrelse per sub-enhet (90 for «36X90G»)" },
  { key: "count_per_package", label: "Ant./pk", step: "1", hint: "Antall sub-enheter per pakke (36 for «36X90G»)" },
];
const TEXT_FIELDS: { key: TextKey; label: string }[] = [
  { key: "sku", label: "Varenr" }, { key: "unit", label: "Enhet" }, { key: "package_unit", label: "Pk.enhet" },
];

/** Fakturalinjer som kort: lesbart i smalt sidepanel og på mobil (390 px) uten horisontal rulling. */
export function PdfLineCards({ lines, onChange, onRemove }: {
  lines: readonly PdfLine[];
  onChange: (idx: number, patch: Partial<PdfLine>) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <ol className="space-y-3">
      {lines.map((l, i) => {
        const id = `pdf-line-${i}`;
        const issues = l.read_issues ?? [];
        return (
          <li key={i} className="rounded-lg border border-line-subtle p-3" aria-labelledby={`${id}-title`}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span id={`${id}-title`} className="text-caption font-semibold text-ink-secondary">Linje {i + 1}</span>
                {l.original && lineEdited(l) && <Badge variant="outline" className="text-[11px]">Endret av deg</Badge>}
                {l.original && l.confidence == null && <Badge variant="outline" className="text-[11px]">Lesesikkerhet mangler</Badge>}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onRemove(i)} aria-label={`Fjern linje ${i + 1}`}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-desc`} className="text-xs">Beskrivelse</Label>
              <Input id={`${id}-desc`} value={l.description ?? ""} onChange={(e) => onChange(i, { description: e.target.value })} className="h-9" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
              {TEXT_FIELDS.slice(0, 2).map((f) => (
                <TextField key={f.key} id={`${id}-${f.key}`} label={f.label} value={l[f.key]} onChange={(v) => onChange(i, { [f.key]: v })} />
              ))}
              {NUM_FIELDS.slice(0, 4).map((f) => (
                <NumField key={f.key} id={`${id}-${f.key}`} label={f.label} step={f.step} value={l[f.key]} onChange={(v) => onChange(i, { [f.key]: v })} />
              ))}
              {NUM_FIELDS.slice(4).map((f) => (
                <NumField key={f.key} id={`${id}-${f.key}`} label={f.label} step={f.step} hint={f.hint} value={l[f.key]} onChange={(v) => onChange(i, { [f.key]: v })} />
              ))}
              <TextField id={`${id}-package_unit`} label={TEXT_FIELDS[2].label} value={l.package_unit} onChange={(v) => onChange(i, { package_unit: v })} />
            </div>
            {issues.length > 0 && (
              <ul className="mt-2 space-y-1 rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">
                {issues.map((x, k) => (
                  <li key={k} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden />{x.message || "Lesevarsel – kontroller mot dokumentet"}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function NumField({ id, label, step, hint, value, onChange }: { id: string; label: string; step: string; hint?: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs" title={hint}>{label}</Label>
      <Input id={id} type="number" inputMode="decimal" step={step} value={value ?? ""} className="h-9"
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
    </div>
  );
}

function TextField({ id, label, value, onChange }: { id: string; label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} value={value ?? ""} className="h-9" onChange={(e) => onChange(e.target.value || null)} />
    </div>
  );
}
