import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { showError } from "@/lib/userError";
import { invalidateInvoice, invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { createRawMaterialFromLine } from "@/fakturaer/lib/createRawMaterial";
import {
  CANONICAL_BASE_UNITS,
  CANONICAL_PACKAGE_UNITS,
  deriveLinePackage,
  fmtNum,
  normalizeUnit,
  parseDecimal,
  resolveLineCost,
  toBaseFactor,
} from "@/fakturaer/lib/units";
import { formatNok } from "@/fakturaer/lib/constants";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lines: ReviewLineRow[];
  onDone?: () => void;
}

interface Draft {
  lineId: string;
  /** Radene brukeren faktisk vil opprette. */
  include: boolean;
  name: string;
  sku: string;
  category: string;
  baseUnit: string;
  packageSize: string;
  /** Enheten pakningsstørrelsen er oppgitt i — kan avvike fra basisenheten. */
  packageUnit: string;
}

function suggestSku(line: ReviewLineRow): string {
  const s = line.supplier_sku?.trim();
  if (s) return s.toUpperCase();
  return (line.description ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-ZÆØÅ0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function inferBaseUnit(unit: string | null | undefined): string {
  const u = normalizeUnit(unit);
  if (u === "g" || u === "kg") return "kg";
  if (u === "ml" || u === "cl" || u === "dl" || u === "l") return "l";
  if (u === "stk") return "stk";
  return "kg";
}

function draftFor(line: ReviewLineRow): Draft {
  const pkg = deriveLinePackage({
    package_size: line.package_size,
    package_unit: line.package_unit,
    count_per_package: line.count_per_package,
    description: line.description,
  });
  const baseUnit = inferBaseUnit(line.unit);
  return {
    lineId: line.id,
    include: true,
    name: line.description ?? "",
    sku: suggestSku(line),
    category: "",
    baseUnit,
    packageSize: pkg ? String(pkg.size) : "",
    // Pakningsenheten fra linjen skal ALDRI antas lik basisenheten: «500 G»
    // på en kg-vare er 0,5 kg, ikke 500 kg.
    packageUnit: pkg?.unit ?? baseUnit,
  };
}

/**
 * Innhold per pakning i basisenheter. Returnerer null når enhetene ikke kan
 * regnes om (f.eks. stk mot kg) — da skal ingen pakningsstørrelse lagres.
 */
export function packageBaseUnits(
  size: number | null,
  packageUnit: string | null | undefined,
  baseUnit: string | null | undefined,
): number | null {
  if (size == null || !(size > 0)) return null;
  const factor = toBaseFactor(packageUnit, baseUnit);
  if (factor == null) return null;
  return size * factor;
}

/**
 * Opprett flere varer på én gang fra valgte fakturalinjer. Hver linje får sin
 * egen rad som kan rettes eller hakes bort før alt lagres — ingenting
 * opprettes blindt.
 */
export function BulkCreateRawMaterialsDialog({ open, onOpenChange, lines, onDone }: Props) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sharedCategory, setSharedCategory] = useState("");
  const [busy, setBusy] = useState(false);

  const lineIds = useMemo(() => lines.map((l) => l.id).join(","), [lines]);

  useEffect(() => {
    if (!open) return;
    setDrafts(lines.map(draftFor));
    setSharedCategory("");
  }, [open, lineIds, lines]);

  function patch(lineId: string, p: Partial<Draft>) {
    setDrafts((d) => d.map((x) => (x.lineId === lineId ? { ...x, ...p } : x)));
  }

  const included = drafts.filter((d) => d.include);
  const missing = included.filter(
    (d) => !d.name.trim() || !d.sku.trim() || !(d.category.trim() || sharedCategory.trim()),
  );

  async function submit() {
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    const invoiceIds = new Set<string>();
    try {
      for (const d of included) {
        const line = lines.find((l) => l.id === d.lineId);
        if (!line) continue;
        const size = parseDecimal(d.packageSize);
        const perPackage = packageBaseUnits(size, d.packageUnit, d.baseUnit);
        const cost = resolveLineCost({
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: line.unit_price,
          totalAmount: line.total_amount,
          packageSize: line.package_size,
          packageUnit: line.package_unit,
          countPerPackage: line.count_per_package,
          description: line.description,
          baseUnit: d.baseUnit,
          supplierPackage:
            size != null && size > 0 ? { packageSize: size, packageUnit: d.packageUnit } : null,
        });
        try {
          await createRawMaterialFromLine({
            line,
            name: d.name,
            sku: d.sku,
            category: d.category.trim() || sharedCategory.trim(),
            baseUnit: d.baseUnit,
            itemType: "ravare",
            supplierSku: line.supplier_sku?.trim() || null,
            packageSize: size,
            packageUnit: size != null ? d.packageUnit : null,
            baseUnitsPerPackage: cost.needsInput ? perPackage : cost.baseUnitsPerPackage ?? perPackage,
            pricePerBaseUnit: cost.needsInput ? null : Number(cost.pricePerBaseUnit.toFixed(4)),
            baseQuantity: cost.needsInput ? null : cost.baseQuantity,
          });
          invoiceIds.add(line.invoice_id);
          ok++;
        } catch (e) {
          const why = e instanceof Error ? e.message : "ukjent feil";
          failed.push(`${d.name || d.sku || "uten navn"} (${why})`);
        }
      }
      invoiceIds.forEach((id) => invalidateInvoice(qc, id));
      invalidateRawMaterial(qc);
      if (failed.length === 0) {
        toast.success(`${ok} varer opprettet`);
        onDone?.();
        onOpenChange(false);
      } else {
        // Radene som feilet blir stående, slik at brukeren kan rette og prøve igjen.
        setDrafts((d) => d.map((x) => ({ ...x, include: failed.some((f) => f.startsWith(x.name)) })));
        toast.warning(`${ok} opprettet. Feilet: ${failed.join(" · ")}`);
        onDone?.();
      }
    } catch (e: unknown) {
      showError("masse-opprett-raavarer", e, "Kunne ikke opprette varene");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Opprett {included.length} nye varer</DialogTitle>
          <DialogDescription>
            Én rad per valgt fakturalinje. Rett navn, varenummer og pakning før du lagrer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Select value={sharedCategory} onValueChange={setSharedCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Felles kategori for alle radene…" />
              </SelectTrigger>
              <SelectContent>
                <CategorySelectItems existing={[sharedCategory]} />
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-auto rounded-lg border border-line-subtle">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-9"><span className="sr-only">Ta med</span></TableHead>
                <TableHead>Navn</TableHead>
                <TableHead className="w-[150px]">Varenummer</TableHead>
                <TableHead className="w-[170px]">Kategori</TableHead>
                <TableHead className="w-[90px]">Basisenhet</TableHead>
                <TableHead className="w-[170px]">Pakning</TableHead>
                <TableHead className="w-[110px] text-right">Fakturabeløp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((d) => {
                const line = lines.find((l) => l.id === d.lineId);
                const size = parseDecimal(d.packageSize);
                const perPackage = packageBaseUnits(size, d.packageUnit, d.baseUnit);
                return (
                  <TableRow key={d.lineId} className={d.include ? undefined : "opacity-50"}>
                    <TableCell>
                      <Checkbox
                        checked={d.include}
                        onCheckedChange={(v) => patch(d.lineId, { include: !!v })}
                        aria-label="Ta med linjen"
                      />
                    </TableCell>
                    <TableCell>
                      <Input value={d.name} onChange={(e) => patch(d.lineId, { name: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input value={d.sku} onChange={(e) => patch(d.lineId, { sku: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Select value={d.category} onValueChange={(v) => patch(d.lineId, { category: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder={sharedCategory || "Kategori"} />
                        </SelectTrigger>
                        <SelectContent>
                          <CategorySelectItems existing={[d.category]} />
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={d.baseUnit} onValueChange={(v) => patch(d.lineId, { baseUnit: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CANONICAL_BASE_UNITS.map((u) => (
                            <SelectItem key={u} value={u}>{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          className="w-[80px]"
                          value={d.packageSize}
                          onChange={(e) => patch(d.lineId, { packageSize: e.target.value })}
                          aria-label="Pakningsstørrelse"
                        />
                        <Select value={d.packageUnit} onValueChange={(v) => patch(d.lineId, { packageUnit: v })}>
                          <SelectTrigger className="w-[80px]" aria-label="Pakningsenhet"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CANONICAL_PACKAGE_UNITS.map((u) => (
                              <SelectItem key={u} value={u}>{u}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="mt-1 text-xs text-ink-secondary">
                        {size != null && size > 0
                          ? perPackage != null
                            ? `= ${fmtNum(perPackage, 4)} ${d.baseUnit} per pakning`
                            : `Kan ikke regne om ${d.packageUnit} til ${d.baseUnit}`
                          : "Ingen pakning"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatNok(line?.total_amount != null ? Number(line.total_amount) : null)}
                      <div className="text-xs text-ink-secondary">
                        {fmtNum(Number(line?.quantity ?? 0))} {normalizeUnit(line?.unit) ?? line?.unit ?? ""}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {missing.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{missing.length} rad(er) mangler navn, varenummer eller kategori.</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Avbryt
          </Button>
          <Button onClick={() => void submit()} disabled={busy || included.length === 0 || missing.length > 0}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Opprett {included.length} varer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
