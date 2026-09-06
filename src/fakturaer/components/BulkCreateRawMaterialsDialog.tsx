import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { showError } from "@/lib/userError";
import { invalidateInvoice, invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { createRawMaterialFromLine } from "@/fakturaer/lib/createRawMaterial";
import { CANONICAL_BASE_UNITS, deriveLinePackage, fmtNum, normalizeUnit, parseDecimal, resolveLineCost } from "@/fakturaer/lib/units";
import { formatNok } from "@/fakturaer/lib/constants";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lines: ReviewLineRow[];
  onDone?: () => void;
}

interface Draft {
  lineId: string;
  name: string;
  sku: string;
  category: string;
  baseUnit: string;
  packageSize: string;
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
  return {
    lineId: line.id,
    name: line.description ?? "",
    sku: suggestSku(line),
    category: "",
    baseUnit: inferBaseUnit(line.unit),
    packageSize: pkg ? String(pkg.size) : "",
  };
}

/**
 * Opprett flere varer på én gang fra valgte fakturalinjer. Hver linje får sin
 * egen rad som kan rettes før alt lagres — ingenting opprettes blindt.
 */
export function BulkCreateRawMaterialsDialog({ open, onOpenChange, lines, onDone }: Props) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sharedCategory, setSharedCategory] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDrafts(lines.map(draftFor));
    setSharedCategory("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lines.map((l) => l.id).join(",")]);

  function patch(lineId: string, p: Partial<Draft>) {
    setDrafts((d) => d.map((x) => (x.lineId === lineId ? { ...x, ...p } : x)));
  }

  const missing = drafts.filter((d) => !d.name.trim() || !d.sku.trim() || !(d.category.trim() || sharedCategory.trim()));

  async function submit() {
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    const invoiceIds = new Set<string>();
    try {
      for (const d of drafts) {
        const line = lines.find((l) => l.id === d.lineId);
        if (!line) continue;
        const size = parseDecimal(d.packageSize);
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
          supplierPackage: size && size > 0 ? { packageSize: size, packageUnit: d.baseUnit } : null,
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
            packageUnit: size != null ? d.baseUnit : null,
            baseUnitsPerPackage: cost.needsInput ? null : cost.baseUnitsPerPackage ?? null,
            pricePerBaseUnit: cost.needsInput ? null : Number(cost.pricePerBaseUnit.toFixed(4)),
            baseQuantity: cost.needsInput ? null : cost.baseQuantity,
          });
          invoiceIds.add(line.invoice_id);
          ok++;
        } catch {
          failed.push(d.name || "uten navn");
        }
      }
      invoiceIds.forEach((id) => invalidateInvoice(qc, id));
      invalidateRawMaterial(qc);
      if (failed.length === 0) toast.success(`${ok} varer opprettet`);
      else toast.warning(`${ok} opprettet, ${failed.length} feilet: ${failed.slice(0, 3).join(", ")}`);
      onDone?.();
      onOpenChange(false);
    } catch (e: unknown) {
      showError("masse-opprett-raavarer", e, "Kunne ikke opprette varene");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Opprett {drafts.length} nye varer</DialogTitle>
          <DialogDescription>
            Én rad per valgt fakturalinje. Rett navn, varenummer og pakning før du lagrer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              value={sharedCategory}
              onChange={(e) => setSharedCategory(e.target.value)}
              placeholder="Felles kategori for alle radene…"
            />
          </div>
        </div>

        <div className="max-h-[50vh] overflow-auto rounded-lg border border-line-subtle">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Navn</TableHead>
                <TableHead className="w-[150px]">Varenummer</TableHead>
                <TableHead className="w-[140px]">Kategori</TableHead>
                <TableHead className="w-[90px]">Basisenhet</TableHead>
                <TableHead className="w-[110px]">Pakning</TableHead>
                <TableHead className="w-[110px] text-right">Fakturabeløp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((d) => {
                const line = lines.find((l) => l.id === d.lineId);
                return (
                  <TableRow key={d.lineId}>
                    <TableCell>
                      <Input value={d.name} onChange={(e) => patch(d.lineId, { name: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input value={d.sku} onChange={(e) => patch(d.lineId, { sku: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={d.category}
                        onChange={(e) => patch(d.lineId, { category: e.target.value })}
                        placeholder={sharedCategory || "Kategori"}
                      />
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
                      <Input
                        type="number"
                        value={d.packageSize}
                        onChange={(e) => patch(d.lineId, { packageSize: e.target.value })}
                        placeholder={`per ${d.baseUnit}`}
                      />
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
          <Button onClick={() => void submit()} disabled={busy || drafts.length === 0 || missing.length > 0}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Opprett {drafts.length} varer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
