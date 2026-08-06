import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Globe, Loader2, Check, X } from "lucide-react";

export interface WebsiteOrderLine {
  display_name?: string | null;
  qty?: number | null;
  unit_of_sale?: string | null;
  price_net?: number | null;
  line_gross?: number | null;
  note?: string | null;
}

interface WebsiteOrderRow {
  id: string;
  site_order_number: string | null;
  status: string;
  status_message: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  is_business_order: boolean | null;
  business_name: string | null;
  business_org_no: string | null;
  pickup_location_name: string | null;
  pickup_date: string | null;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  total_gross: number | null;
  customer_note: string | null;
  lines: unknown;
  received_at: string | null;
}

const PENDING_STATUSES = ["received", "partially_approved"];

export const websiteOrdersQueryKey = ["website-orders", "pending"] as const;

function parseLines(lines: unknown): WebsiteOrderLine[] {
  if (Array.isArray(lines)) return lines as WebsiteOrderLine[];
  return [];
}

function nok(v: number | null | undefined) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    minimumFractionDigits: 2,
  }).format(Number(v ?? 0));
}

function formatDate(d: string | null) {
  if (!d) return "–";
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium" }).format(new Date(d + "T00:00:00"));
}

function formatWindow(start: string | null, end: string | null) {
  if (!start && !end) return null;
  const trim = (t: string | null) => (t ? t.slice(0, 5) : "");
  return `${trim(start)}${end ? `–${trim(end)}` : ""}`;
}

export default function WebsiteOrders() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<WebsiteOrderRow | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: websiteOrdersQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("website_orders")
        .select(
          "id, site_order_number, status, status_message, customer_name, customer_email, customer_phone, is_business_order, business_name, business_org_no, pickup_location_name, pickup_date, pickup_window_start, pickup_window_end, total_gross, customer_note, lines, received_at",
        )
        .in("status", PENDING_STATUSES)
        .order("received_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as WebsiteOrderRow[];
    },
    staleTime: 15_000,
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("convert_website_order", {
        p_website_order_id: id,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (orderId) => {
      toast.success("Ordre opprettet");
      queryClient.invalidateQueries({ queryKey: websiteOrdersQueryKey });
      queryClient.invalidateQueries({ queryKey: ["website-orders", "pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      setSelected(null);
      if (orderId) navigate(`/ordre/ordrer/${orderId}`);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Kunne ikke opprette ordre");
    },
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase
        .from("website_orders")
        .update({
          status: "rejected",
          status_message: reason.trim() || null,
          processed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nettbutikk-ordren er avvist");
      queryClient.invalidateQueries({ queryKey: websiteOrdersQueryKey });
      queryClient.invalidateQueries({ queryKey: ["website-orders", "pending-count"] });
      setRejectOpen(false);
      setRejectReason("");
      setSelected(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Kunne ikke avvise ordren");
    },
  });

  const selectedLines = parseLines(selected?.lines);

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Globe className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nettbutikk-ordre</h1>
          <p className="text-sm text-muted-foreground">
            Godkjenn innkomne ordre fra nettbutikken og opprett ekte ordre.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Ordre som validerer automatisk legges rett i ordrelisten under{" "}
        <span className="font-medium text-foreground">Til godkjenning</span>. Her ligger kun
        ordre som trenger manuell håndtering.
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Venter på godkjenning{" "}
            <span className="text-muted-foreground">({orders.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Laster …
            </div>
          ) : orders.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Ingen nettbutikk-ordre venter på godkjenning.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ordrenr.</TableHead>
                  <TableHead>Kunde</TableHead>
                  <TableHead>Hentedato</TableHead>
                  <TableHead>Hentested</TableHead>
                  <TableHead className="text-right">Linjer</TableHead>
                  <TableHead className="text-right">Sum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow
                    key={o.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(o)}
                  >
                    <TableCell className="font-medium">
                      {o.site_order_number ?? "–"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{o.customer_name ?? "–"}</span>
                        {o.is_business_order && <Badge variant="secondary">Bedrift</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(o.pickup_date)}</TableCell>
                    <TableCell>{o.pickup_location_name ?? "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {parseLines(o.lines).length}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {nok(o.total_gross)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Nettbutikk-ordre {selected?.site_order_number ?? ""}
              {selected?.is_business_order && <Badge variant="secondary">Bedrift</Badge>}
            </DialogTitle>
            <DialogDescription>
              Kontroller innholdet før du oppretter en ekte ordre.
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1 text-sm">
                  <div className="font-medium">Kunde</div>
                  <div>{selected.customer_name ?? "–"}</div>
                  {selected.customer_email && (
                    <div className="text-muted-foreground">{selected.customer_email}</div>
                  )}
                  {selected.customer_phone && (
                    <div className="text-muted-foreground">{selected.customer_phone}</div>
                  )}
                  {selected.business_name && (
                    <div className="text-muted-foreground">
                      {selected.business_name}
                      {selected.business_org_no ? ` (org.nr. ${selected.business_org_no})` : ""}
                    </div>
                  )}
                </div>
                <div className="space-y-1 text-sm">
                  <div className="font-medium">Henting</div>
                  <div>{formatDate(selected.pickup_date)}</div>
                  {formatWindow(selected.pickup_window_start, selected.pickup_window_end) && (
                    <div className="text-muted-foreground">
                      {formatWindow(selected.pickup_window_start, selected.pickup_window_end)}
                    </div>
                  )}
                  <div className="text-muted-foreground">
                    {selected.pickup_location_name ?? "–"}
                  </div>
                </div>
              </div>

              {selected.customer_note && (
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <div className="mb-1 font-medium">Kundens melding</div>
                  <div className="whitespace-pre-wrap">{selected.customer_note}</div>
                </div>
              )}

              <Separator />

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vare</TableHead>
                    <TableHead className="text-right">Antall</TableHead>
                    <TableHead>Enhet</TableHead>
                    <TableHead className="text-right">Pris (netto)</TableHead>
                    <TableHead className="text-right">Sum (brutto)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedLines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <div>{l.display_name ?? "–"}</div>
                        {l.note && (
                          <div className="text-xs text-muted-foreground">{l.note}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.qty ?? 0}</TableCell>
                      <TableCell>{l.unit_of_sale ?? "–"}</TableCell>
                      <TableCell className="text-right tabular-nums">{nok(l.price_net)}</TableCell>
                      <TableCell className="text-right tabular-nums">{nok(l.line_gross)}</TableCell>
                    </TableRow>
                  ))}
                  {selectedLines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        Ingen linjer
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              <div className="flex justify-end text-sm font-medium tabular-nums">
                Totalt: {nok(selected.total_gross)}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRejectReason("");
                setRejectOpen(true);
              }}
              disabled={approve.isPending}
            >
              <X className="mr-1.5 h-4 w-4" /> Avvis
            </Button>
            <Button
              onClick={() => selected && approve.mutate(selected.id)}
              disabled={approve.isPending || !selected}
            >
              {approve.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-4 w-4" />
              )}
              Godkjenn og opprett ordre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Avvis nettbutikk-ordre</DialogTitle>
            <DialogDescription>
              Du kan legge ved en valgfri begrunnelse.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Begrunnelse (valgfritt)"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Avbryt
            </Button>
            <Button
              variant="destructive"
              disabled={reject.isPending || !selected}
              onClick={() =>
                selected && reject.mutate({ id: selected.id, reason: rejectReason })
              }
            >
              {reject.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Avvis ordre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
