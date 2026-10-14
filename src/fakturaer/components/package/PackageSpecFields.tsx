import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONTAINER_OPTIONS, contentUnitsFor, describePackageSpec, type PackageSpecInput } from "@/fakturaer/lib/packageSpec";

interface Props {
  idPrefix: string;
  baseUnit: string;
  /** Enheten slik den står på fakturalinjen (rå). Vises alltid separat, aldri omdøpt. */
  invoiceUnit: string | null;
  value: PackageSpecInput;
  onChange: (v: PackageSpecInput) => void;
  /** Kan «Kjøpes som» endres her? I linjeskjemaet må fakturaens enhet rettes via «Rett fakturalinje». */
  containerEditable: boolean;
  disabled?: boolean;
}

/** Felles pakningsfelt: Fakturert som · Kjøpes som · Innhold per beholder (størrelse + enhet). */
export function PackageSpecFields(p: Props) {
  const spec = describePackageSpec(p.value, p.baseUnit, p.invoiceUnit);
  const units = contentUnitsFor(p.baseUnit);
  const set = (patch: Partial<PackageSpecInput>) => p.onChange({ ...p.value, ...patch });
  const c = p.value.container || "pakning";
  return (
    <div className="space-y-2">
      <p className="text-caption text-ink-secondary">
        Fakturert som: <strong className="text-ink-primary">{p.invoiceUnit?.trim() || "ukjent enhet"}</strong>
      </p>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr_7rem]">
        <div>
          <Label htmlFor={`${p.idPrefix}-container`} className="text-caption">Kjøpes som</Label>
          <Select value={p.value.container} onValueChange={(v) => set({ container: v })} disabled={p.disabled || !p.containerEditable}>
            <SelectTrigger id={`${p.idPrefix}-container`} className="mt-1 min-h-[44px]"><SelectValue placeholder="Velg" /></SelectTrigger>
            <SelectContent>
              {CONTAINER_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${p.idPrefix}-size`} className="text-caption">Innhold per {c}</Label>
          <Input id={`${p.idPrefix}-size`} inputMode="decimal" className="mt-1 min-h-[44px]" value={p.value.size} disabled={p.disabled}
            aria-invalid={spec.state === "invalid"} onChange={(e) => set({ size: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${p.idPrefix}-cunit`} className="text-caption">Enhet</Label>
          <Select value={p.value.contentUnit} onValueChange={(v) => set({ contentUnit: v })} disabled={p.disabled}>
            <SelectTrigger id={`${p.idPrefix}-cunit`} aria-label={`Enhet for innhold per ${c}`} className="mt-1 min-h-[44px]"><SelectValue placeholder="Velg" /></SelectTrigger>
            <SelectContent>
              {units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {spec.state === "valid" && <p className="text-caption" aria-live="polite">{spec.text}</p>}
      {spec.state === "invalid" && <p role="alert" className="rounded-md bg-warning/10 px-3 py-2 text-caption text-warning">{spec.reason}</p>}
      {spec.containerMismatch && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-caption text-warning">
          {p.containerEditable
            ? `Fakturaen sier «${p.invoiceUnit}», du har valgt «${p.value.container}». Pakningen lagres for leverandøren som ${p.value.container}; fakturalinjen endres ikke.`
            : `Fakturaen sier «${p.invoiceUnit}». Skal linjen være ${p.value.container}, rett fakturalinjen («Rett fakturalinje») med begrunnelse.`}
        </p>
      )}
    </div>
  );
}
