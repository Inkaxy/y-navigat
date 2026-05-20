import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeliveryNoteDetail } from "@/ordre/hooks/useDeliveryNoteDetail";
import { useSaveDeliveryNote, type EditableLine } from "@/ordre/hooks/useSaveDeliveryNote";
import { formatDate, formatNOK } from "@/ordre/lib/format";
import { cn } from "@/lib/utils";
import { PakkseddelPDFButton } from "@/ordre/components/pakksedler/PakkseddelPDFButton";
import { AddProductDialog } from "@/ordre/components/orders/AddProductDialog";

const PRICE_TOGGLE_STORAGE_KEY = "nbos.order.showInternalPrices";

function isoWeek(iso: string): number {
  const d = new Date(iso + "T12:00:00");
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-muted text-foreground" },
    printed: { label: "Skrevet ut", cls: "bg-blue-100 text-blue-900" },
    delivered: { label: "Levert", cls: "bg-emerald-100 text-emerald-900" },
    under_correction: { label: "Korrigeres", cls: "bg-amber-100 text-amber-900" },
    finalized: { label: "Finalisert", cls: "bg-emerald-200 text-emerald-950" },
    invoiced: { label: "Fakturert", cls: "bg-purple-200 text-purple-950" },
    cancelled: { label: "Kansellert", cls: "bg-destructive/15 text-destructive" },
  };
  return map[status] ?? { label: status, cls: "bg-muted text-foreground" };
}

function round(n: number, d = 2) {
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}

export default function DeliveryNoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useDeliveryNoteDetail(id);
  const save = useSaveDeliveryNote();

  const [showPrices, setShowPrices] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(PRICE_TOGGLE_STORAGE_KEY) === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PRICE_TOGGLE_STORAGE_KEY, showPrices ? "1" : "0");
  }, [showPrices]);

  const [lines, setLines] = useState<EditableLine[]>([]);
  const [originalIds, setOriginalIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Synkroniser server→state ved (re)load
  useEffect(() => {
    if (!data) return;
    setLines(
      data.lines.map((l) => ({
        id: l.id,
        product_id: l.product_id,
        product_snapshot: (l.product_snapshot ?? {}) as Record<string, unknown>,
        quantity: l.quantity,
        sales_unit: l.sales_unit,
        unit_price: l.unit_price,
        discount_percent: l.discount_percent,
        vat_rate: l.vat_rate,
        notes: l.notes,
        order_line_id: l.order_line_id,
        order_id: l.order_id,
      }))
    );
    setOriginalIds(data.lines.map((l) => l.id));
    setNotes(data.notes ?? "");
    setDirty(false);
  }, [data]);

  const locked = data?.status === "invoiced" || data?.status === "cancelled";

  const totals = useMemo(() => {
    let s = 0, v = 0, t = 0;
    for (const l of lines) {
      const gross = l.quantity * l.unit_price;
      const sub = round(gross * (1 - (l.discount_percent || 0) / 100), 2);
      const vat = round(sub * (l.vat_rate / 100), 2);
      s = round(s + sub, 2);
      v = round(v + vat, 2);
      t = round(t + sub + vat, 2);
    }
    return { subtotal: s, vat: v, total: t };
  }, [lines]);

  const fallbackOrderId = useMemo(() => {
    return lines.find((l) => l.order_id)?.order_id ?? null;
  }, [lines]);

  function updateLine(idx: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    setDirty(true);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  }

  async function onSave() {
    if (!id) return;
    try {
      await save.mutateAsync({
        deliveryNoteId: id,
        lines,
        originalLineIds: originalIds,
        fallbackOrderId,
        notes: notes || null,
      });
      toast.success("Pakkseddel oppdatert");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lagring feilet");
    }
  }

  if (isLoading) {
    return <div className="mx-auto max-w-5xl px-4 py-10 text-center text-muted-foreground">Laster pakkseddel…</div>;
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Tilbake
        </Button>
        <p className="text-destructive">Pakkseddelen ble ikke funnet.</p>
      </div>
    );
  }

  const cs = data.customer_snapshot ?? {};
  const addr = data.delivery_address_snapshot ?? {};
  const customerName =
    (cs["display_name"] as string | undefined) ?? (cs["name"] as string | undefined) ?? "—";
  const customerNumberRaw = cs["customer_number"] as string | number | undefined;
  const customerNumber =
    customerNumberRaw === undefined || customerNumberRaw === null || customerNumberRaw === ""
      ? null
      : String(customerNumberRaw);
  const line1 =
    (addr["line1"] as string | undefined) ??
    (addr["address_line_1"] as string | undefined) ??
    (addr["address_line1"] as string | undefined) ??
    "";
  const line2 =
    (addr["line2"] as string | undefined) ??
    (addr["address_line_2"] as string | undefined) ??
    (addr["address_line2"] as string | undefined) ??
    "";
  const postal = (addr["postal_code"] as string | undefined) ?? "";
  const city = (addr["city"] as string | undefined) ?? "";
  const sb = statusBadge(data.status);
  const week = isoWeek(data.delivery_date);
  const le = data.legal_entity;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Tilbake
        </Button>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="show-prices" checked={showPrices} onCheckedChange={setShowPrices} />
            <Label htmlFor="show-prices" className="cursor-pointer text-sm text-muted-foreground">
              Vis interne priser
            </Label>
          </div>
          <PakkseddelPDFButton id={data.id} />
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Pakkseddel</div>
            <div className="text-2xl font-bold tabular-nums">#{data.display_number}</div>
          </div>
        </div>
      </div>

      {le && (
        <div className="rounded-md border bg-muted/30 px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span className="font-semibold text-foreground">{le.legal_name}</span>
          {le.org_number && <span> · org.nr {le.org_number}</span>}
          {le.invoice_address_line1 && <span> · {le.invoice_address_line1}</span>}
          {(le.invoice_postal_code || le.invoice_city) && (
            <span>
              {", "}
              {le.invoice_postal_code} {le.invoice_city}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 rounded-lg border bg-background p-6 md:grid-cols-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Kunde</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{customerName}</span>
            {customerNumber && (
              <Badge variant="secondary" className="font-normal tabular-nums">
                #{customerNumber}
              </Badge>
            )}
          </div>
          {line1 && <div className="text-sm">{line1}</div>}
          {line2 && <div className="text-sm">{line2}</div>}
          {(postal || city) && (
            <div className="text-sm">
              {postal} {city}
            </div>
          )}
        </div>
        <div className="space-y-1 text-sm">
          <div>
            <span className="inline-block w-24 text-muted-foreground">Kundenr:</span>
            <span className="font-medium tabular-nums">{customerNumber ?? "—"}</span>
          </div>
          <div>
            <span className="inline-block w-24 text-muted-foreground">Dato:</span>
            <span className="font-medium">
              {formatDate(data.delivery_date)} (uke {week})
            </span>
          </div>
          <div>
            <span className="inline-block w-24 text-muted-foreground">Tur:</span>
            <span className="font-medium">{data.route_label ?? "—"}</span>
          </div>
          <div>
            <span className="inline-block w-24 text-muted-foreground">Status:</span>
            <Badge className={cn("font-normal", sb.cls)} variant="outline">
              {sb.label}
            </Badge>
          </div>
        </div>
      </div>

      {locked && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Pakkseddelen er <strong>{sb.label.toLowerCase()}</strong> og kan ikke endres.
        </div>
      )}

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Nr</TableHead>
              <TableHead>Varenavn</TableHead>
              <TableHead className="w-24 text-right">Antall</TableHead>
              <TableHead className="w-16">Enhet</TableHead>
              {showPrices && <TableHead className="w-32 text-right">Pris</TableHead>}
              {showPrices && <TableHead className="w-24 text-right">% rab</TableHead>}
              {showPrices && <TableHead className="w-28 text-right">Sum</TableHead>}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={showPrices ? 8 : 5} className="text-center text-muted-foreground">
                  Ingen linjer.
                </TableCell>
              </TableRow>
            )}
            {lines.map((l, idx) => {
              const ps = l.product_snapshot ?? {};
              const productNumber =
                (ps["display_number"] as string | number | undefined) ??
                (ps["product_number"] as string | number | undefined) ??
                "—";
              const productName =
                (ps["display_name"] as string | undefined) ?? (ps["name"] as string | undefined) ?? "—";
              const gross = l.quantity * l.unit_price;
              const sub = gross * (1 - (l.discount_percent || 0) / 100);
              const lineTotal = sub * (1 + l.vat_rate / 100);
              return (
                <TableRow key={l.id ?? `new-${idx}`}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {String(productNumber)}
                  </TableCell>
                  <TableCell>
                    <div>{productName}</div>
                    <Input
                      value={l.notes ?? ""}
                      onChange={(e) => updateLine(idx, { notes: e.target.value })}
                      placeholder="Linjekommentar…"
                      disabled={locked}
                      className="mt-1 h-7 text-xs"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="1"
                      value={l.quantity}
                      onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) || 0 })}
                      disabled={locked}
                      className="h-8 px-2 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.sales_unit}</TableCell>
                  {showPrices && (
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={l.unit_price}
                        onChange={(e) => updateLine(idx, { unit_price: Number(e.target.value) || 0 })}
                        disabled={locked}
                        className="h-8 px-2 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </TableCell>
                  )}
                  {showPrices && (
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={100}
                        step="1"
                        value={l.discount_percent}
                        onChange={(e) =>
                          updateLine(idx, { discount_percent: Number(e.target.value) || 0 })
                        }
                        disabled={locked}
                        className="h-8 px-2 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </TableCell>
                  )}
                  {showPrices && (
                    <TableCell className="text-right tabular-nums">{formatNOK(lineTotal)}</TableCell>
                  )}
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={locked}
                      onClick={() => removeLine(idx)}
                      aria-label="Slett linje"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border-t p-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setPickerOpen(true)}
            disabled={locked}
          >
            <Plus className="h-4 w-4" /> Ny ordrelinje
          </Button>
          {showPrices && (
            <div className="w-72 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal eks mva:</span>
                <span className="tabular-nums">{formatNOK(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">MVA:</span>
                <span className="tabular-nums">{formatNOK(totals.vat)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 text-base font-semibold">
                <span>Total inkl mva:</span>
                <span className="tabular-nums">{formatNOK(totals.total)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-background p-4">
        <Label htmlFor="dn-notes" className="text-xs uppercase tracking-wide text-muted-foreground">
          Notater
        </Label>
        <Textarea
          id="dn-notes"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
          disabled={locked}
          placeholder="Notater til pakkseddel/faktura…"
          rows={3}
          className="mt-2"
        />
      </div>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
        {dirty && <span className="text-sm text-muted-foreground">Endringer ikke lagret</span>}
        <Button
          onClick={onSave}
          disabled={locked || !dirty || save.isPending}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? "Lagrer…" : "Lagre pakkseddel"}
        </Button>
      </div>

      <AddProductDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        customerId={data.customer_id}
        onPick={(p) => {
          // Default VAT fra eksisterende linjer (vanligst), fallback 15
          const defaultVat =
            lines.find((l) => l.vat_rate > 0)?.vat_rate ?? 15;
          setLines((prev) => [
            ...prev,
            {
              id: null,
              product_id: p.id,
              product_snapshot: {
                display_number: p.display_number,
                display_name: p.display_name,
                product_number: p.display_number,
                name: p.display_name,
              },
              quantity: 1,
              sales_unit: p.sales_unit,
              unit_price: p.unit_price ?? 0,
              discount_percent: 0,
              vat_rate: defaultVat,
              notes: null,
              order_line_id: null,
              order_id: fallbackOrderId,
            },
          ]);
          setDirty(true);
        }}
      />
    </div>
  );
}
