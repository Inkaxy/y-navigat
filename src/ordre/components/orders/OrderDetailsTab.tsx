import { useState } from "react";
import { ExternalLink, AlertTriangle, Info, Truck, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateLong, formatNOK, formatNumber } from "@/ordre/lib/format";
import { useCustomerById } from "@/ordre/hooks/useNBCustomers";
import { categorizePriceSource } from "@/ordre/hooks/useNBProducts";
import { useDeliveryTours, trimSec } from "@/ordre/hooks/useDeliveryTours";
import { ChangeTourDialog } from "@/ordre/components/orders/ChangeTourDialog";
import type { OrderDetail, OrderLineDetail } from "@/ordre/hooks/useOrderDetail";
import { StockAvailabilityWarning } from "@/ordre/components/orders/StockAvailabilityWarning";
import { PriceSourceBadge } from "@/ordre/components/orders/PriceSourceBadge";

const KUNDER_APP_BASE = "https://kunder.nbos.app"; // ekstern app — kommer som env-konfig senere

export function OrderDetailsTab({ order, lines }: { order: OrderDetail; lines: OrderLineDetail[] }) {
  const { data: liveCustomer } = useCustomerById(order.customer_id);
  const { data: tours = [] } = useDeliveryTours();
  const [tourDialogOpen, setTourDialogOpen] = useState(false);
  const snap = (order.customer_snapshot ?? {}) as Record<string, string | null | undefined>;
  const invSnap = order.invoice_recipient_snapshot as Record<string, string | null | undefined> | null;
  const orderTour = (order as OrderDetail & { delivery_tour_id?: string | null }).delivery_tour_id
    ? tours.find((t) => t.id === (order as OrderDetail & { delivery_tour_id?: string | null }).delivery_tour_id)
    : null;
  const currentTourId = (order as OrderDetail & { delivery_tour_id?: string | null }).delivery_tour_id ?? null;

  // Adresse-avvik fra kunden's nåværende default
  const orderAddr = [order.delivery_address_line1, order.delivery_postal_code, order.delivery_city]
    .filter(Boolean)
    .join(" ");
  const customerAddr = liveCustomer
    ? [liveCustomer.delivery_address_line1, liveCustomer.delivery_postal_code, liveCustomer.delivery_city]
        .filter(Boolean)
        .join(" ")
    : "";
  const addressDiffers = !!liveCustomer && orderAddr && customerAddr && orderAddr !== customerAddr;

  // VAT-grupper
  const vatGroups = lines.reduce<Record<string, { base: number; vat: number }>>((acc, l) => {
    const k = String(l.vat_rate);
    if (!acc[k]) acc[k] = { base: 0, vat: 0 };
    acc[k].base += Number(l.line_subtotal_excl_vat);
    acc[k].vat += Number(l.line_vat);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Seksjon 1: Kunde */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kunde</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <a
                href={`${KUNDER_APP_BASE}/kundeliste/${order.customer_id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                {snap.customer_number} — {snap.display_name}
                <ExternalLink className="h-3 w-3" />
              </a>
              {snap.organization_number && (
                <div className="text-xs text-muted-foreground">Org.nr: {snap.organization_number}</div>
              )}
            </div>
          </div>
          {(snap.primary_contact_name || snap.primary_contact_email) && (
            <div className="text-muted-foreground">
              {snap.primary_contact_name && <span>{snap.primary_contact_name}</span>}
              {snap.primary_contact_name && snap.primary_contact_email && <span> · </span>}
              {snap.primary_contact_email && <span>{snap.primary_contact_email}</span>}
            </div>
          )}
          {(order as OrderDetail & { customer_reference?: string | null }).customer_reference && (
            <div className="text-xs">
              <span className="text-muted-foreground">Kundereferanse:</span>{" "}
              <span className="font-medium">
                {(order as OrderDetail & { customer_reference?: string | null }).customer_reference}
              </span>
              {liveCustomer?.enforce_custom_reference && (
                <span className="ml-1 text-muted-foreground">(fast referanse)</span>
              )}
            </div>
          )}
          {invSnap && (
            <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
              <span className="font-medium">Faktura går til:</span>{" "}
              {invSnap.display_name} ({invSnap.customer_number})
            </div>
          )}
          {liveCustomer?.credit_hold && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <div>
                <strong>Kreditstopp aktiv.</strong>{" "}
                {liveCustomer.credit_hold_reason ?? "Ingen grunn oppgitt."}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Seksjon 2: Levering */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Levering</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">Leveringsdato</div>
              <div className="font-medium">{formatDateLong(order.delivery_date)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Leveringstid</div>
              <div className="font-medium">{order.delivery_time ?? "—"}</div>
            </div>
          </div>

          {/* Tur-rad */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
            <Truck className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Tur:</span>
            {orderTour ? (
              <>
                <span className="text-sm font-medium">
                  Tur {orderTour.tour_number} — {orderTour.display_name}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({trimSec(orderTour.time_from)}–{trimSec(orderTour.time_to)})
                </span>
              </>
            ) : (
              <span className="text-sm italic text-muted-foreground">Ingen tur tildelt</span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-7 gap-1 px-2 text-xs"
              onClick={() => setTourDialogOpen(true)}
            >
              <Pencil className="h-3 w-3" />
              Endre
            </Button>
          </div>

          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              Leveringsadresse
              {addressDiffers && (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Info className="h-3 w-3" />
                  Avviker fra kundens default
                </Badge>
              )}
            </div>
            <div>
              {order.delivery_address_line1 ?? "—"}
              {order.delivery_address_line2 && (
                <>
                  <br />
                  {order.delivery_address_line2}
                </>
              )}
              {(order.delivery_postal_code || order.delivery_city) && (
                <>
                  <br />
                  {order.delivery_postal_code} {order.delivery_city}
                </>
              )}
            </div>
          </div>
          {order.delivery_instructions && (
            <div>
              <div className="text-xs text-muted-foreground">Merknader til sjåfør</div>
              <div>{order.delivery_instructions}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Seksjon 3: Ordrelinjer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ordrelinjer ({lines.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Ingen ordrelinjer.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Produkt</TableHead>
                  <TableHead className="text-right">Mengde</TableHead>
                  <TableHead className="text-right">Pris/enhet</TableHead>
                  <TableHead className="text-right">Rab.%</TableHead>
                  <TableHead className="text-right">MVA%</TableHead>
                  <TableHead className="text-right">Sum inkl.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const ps = (l.product_snapshot ?? {}) as Record<string, string | number | null | undefined>;
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-muted-foreground">{l.line_number}</TableCell>
                      <TableCell>
                        <div className="font-medium">{ps.display_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {ps.code} {ps.display_number ? `· #${ps.display_number}` : ""}
                        </div>
                        {l.notes && <div className="mt-1 text-xs italic text-muted-foreground">{l.notes}</div>}
                        <StockAvailabilityWarning
                          productId={l.product_id}
                          quantity={Number(l.quantity) || 0}
                          className="mt-1"
                        />

                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(l.quantity, 3)} <span className="text-xs text-muted-foreground">{l.sales_unit}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div>{formatNOK(l.unit_price)}</div>
                        <div className="mt-0.5">
                          <PriceSourceBadge source={l.unit_price_source} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(l.discount_percent, 1)}</TableCell>
                      <TableCell className="text-right">{formatNumber(l.vat_rate, 0)}</TableCell>
                      <TableCell className="text-right font-medium">{formatNOK(l.line_total_incl_vat)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Seksjon 4: Sammendrag og notater */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sammendrag</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sum eks. mva</span>
              <span>{formatNOK(order.subtotal_excl_vat)}</span>
            </div>
            {Number(order.total_discount) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Total rabatt</span>
                <span>−{formatNOK(order.total_discount)}</span>
              </div>
            )}
            {Object.entries(vatGroups).map(([rate, v]) => (
              <div key={rate} className="flex justify-between text-muted-foreground">
                <span>MVA {rate}%</span>
                <span>{formatNOK(v.vat)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <span>Sum inkl. mva</span>
              <span>{formatNOK(order.total_incl_vat)}</span>
            </div>
          </div>

          {(order.production_notes || order.store_notes) && (
            <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
              {order.production_notes && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Produksjonsnotat
                  </div>
                  <div className="whitespace-pre-wrap rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-sm">
                    {order.production_notes}
                  </div>
                </div>
              )}
              {order.store_notes && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
                    Butikknotat
                  </div>
                  <div className="whitespace-pre-wrap rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-sm">
                    {order.store_notes}
                  </div>
                </div>
              )}
            </div>
          )}

          {(order.internal_notes || order.customer_notes) && (
            <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
              {order.internal_notes && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Interne notater</div>
                  <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 text-sm">
                    {order.internal_notes}
                  </div>
                </div>
              )}
              {order.customer_notes && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Notat fra kunde</div>
                  <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 text-sm">
                    {order.customer_notes}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ChangeTourDialog
        open={tourDialogOpen}
        onOpenChange={setTourDialogOpen}
        orderId={order.id}
        orderNumber={order.order_number}
        legalEntityId={order.legal_entity_id}
        currentTourId={currentTourId}
      />
    </div>
  );
}
