import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  /** Åpner «Rett fakturert enhet» (bare enhet + begrunnelse via rm_correct_invoice_line). */
  onCorrectUnit?: () => void;
}

/** Felles pakningsfelt: Fakturert som · Kjøpes som · Innhold per beholder (størrelse + enhet). */
export function PackageSpecFields(p: Props) {
  const spec = describePackageSpec(p.value, p.baseUnit, p.invoiceUnit);
  const units = contentUnitsFor(p.baseUnit);
  const set = (patch: Partial<PackageSpecInput>) => p.onChange({ ...p.value, ...patch });
  const c = p.value.container || "pakning";
  // Varer som telles i stk: innholdet er et antall. Vekt/volum blandes aldri inn i antallet.
  const isPieces = p.baseUnit === "stk";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-secondary">
          Fakturert som: <strong className="text-ink-primary">{p.invoiceUnit?.trim() || "ukjent enhet"}</strong>
        </p>
        {p.onCorrectUnit && (
          <Button type="button" variant="outline" size="sm" className="min-h-[44px]" disabled={p.disabled} onClick={p.onCorrectUnit}>
            Rett fakturert enhet
          </Button>
        )}
      </div>
      <div className={isPieces ? "grid gap-2 sm:grid-cols-[10rem_1fr]" : "grid gap-2 sm:grid-cols-[10rem_1fr_7rem]"}>
        <div>
          <Label htmlFor={`${p.idPrefix}-container`} className="text-caption">Kjøpes som</Label>
          <Select value={p.value.container} onValueChange={(v) => set({ container: v })} disabled={p.disabled || !p.containerEditable}>
            <SelectTrigger id={`${p.idPrefix}-container`} className="mt-1 min-h-[44px]"><SelectValue placeholder="Velg" /></SelectTrigger>
            <SelectContent>
              {[...CONTAINER_OPTIONS, ...(p.value.container && !(CONTAINER_OPTIONS as readonly string[]).includes(p.value.container) ? [p.value.container] : [])].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${p.idPrefix}-size`} className="text-caption">{isPieces ? `Antall stk per ${c}` : `Innhold per ${c}`}</Label>
          <Input id={`${p.idPrefix}-size`} inputMode="decimal" className="mt-1 min-h-[44px]" value={p.value.size} disabled={p.disabled}
            aria-invalid={spec.state === "invalid"} onChange={(e) => set({ size: e.target.value })} />
        </div>
        {!isPieces && <div>
          <Label htmlFor={`${p.idPrefix}-cunit`} className="text-caption">Enhet</Label>
          <Select value={p.value.contentUnit} onValueChange={(v) => set({ contentUnit: v })} disabled={p.disabled}>
            <SelectTrigger id={`${p.idPrefix}-cunit`} aria-label={`Enhet for innhold per ${c}`} className="mt-1 min-h-[44px]"><SelectValue placeholder="Velg" /></SelectTrigger>
            <SelectContent>
              {units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>}
      </div>
      {spec.state === "valid" && <p className="text-caption" aria-live="polite">{spec.text}</p>}
      {spec.state === "invalid" && <p role="alert" className="rounded-md bg-warning/10 px-3 py-2 text-caption text-warning">{spec.reason}</p>}
      {spec.containerMismatch && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-caption text-warning">
          {`Fakturaen sier «${p.invoiceUnit}». Skal linjen være ${p.value.container}, bruk «Rett fakturert enhet» med begrunnelse. Pakningen kan ikke lagres før enheten er rettet.`}
        </p>
      )}
    </div>
  );
}
