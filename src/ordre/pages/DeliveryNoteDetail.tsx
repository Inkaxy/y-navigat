import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeliveryNoteDetail } from "@/ordre/hooks/useDeliveryNoteDetail";
import { formatDate, formatNOK, formatNumber } from "@/ordre/lib/format";
import { cn } from "@/lib/utils";
import { PakkseddelPDFButton } from "@/ordre/components/pakksedler/PakkseddelPDFButton";

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

export default function DeliveryNoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useDeliveryNoteDetail(id);

  const [showPrices, setShowPrices] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(PRICE_TOGGLE_STORAGE_KEY) === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PRICE_TOGGLE_STORAGE_KEY, showPrices ? "1" : "0");
  }, [showPrices]);

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
            <Switch
              id="show-prices"
              checked={showPrices}
              onCheckedChange={setShowPrices}
            />
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

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Varenr</TableHead>
              <TableHead>Varenavn</TableHead>
              <TableHead className="text-right">Antall</TableHead>
              <TableHead>Enhet</TableHead>
              {showPrices && <TableHead className="text-right">Pris</TableHead>}
              {showPrices && <TableHead className="text-right">Sum</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={showPrices ? 6 : 4} className="text-center text-muted-foreground">
                  Ingen linjer.
                </TableCell>
              </TableRow>
            )}
            {data.lines.map((l) => {
              const ps = l.product_snapshot ?? {};
              const productNumber =
                (ps["display_number"] as string | number | undefined) ??
                (ps["product_number"] as string | number | undefined) ??
                "—";
              const productName =
                (ps["display_name"] as string | undefined) ?? (ps["name"] as string | undefined) ?? "—";
              return (
                <TableRow key={l.id}>
                  <TableCell className="tabular-nums">{String(productNumber)}</TableCell>
                  <TableCell>{productName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(l.quantity, 0)}</TableCell>
                  <TableCell>{l.sales_unit}</TableCell>
                  {showPrices && (
                    <TableCell className="text-right tabular-nums">{formatNOK(l.unit_price)}</TableCell>
                  )}
                  {showPrices && (
                    <TableCell className="text-right tabular-nums">{formatNOK(l.line_total_incl_vat)}</TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {showPrices && (
          <div className="flex justify-end border-t p-4">
            <div className="w-72 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal eks mva:</span>
                <span className="tabular-nums">{formatNOK(data.subtotal_excl_vat)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">MVA:</span>
                <span className="tabular-nums">{formatNOK(data.total_vat)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 text-base font-semibold">
                <span>Total inkl mva:</span>
                <span className="tabular-nums">{formatNOK(data.total_incl_vat)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {data.notes && (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          <div className="mb-1 font-medium">Notater</div>
          <div className="whitespace-pre-wrap">{data.notes}</div>
        </div>
      )}
    </div>
  );
}
