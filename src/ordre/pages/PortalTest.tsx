import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Beaker, AlertTriangle, CheckCircle2, ExternalLink, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useNBCustomers } from "@/ordre/hooks/useNBCustomers";
import { useNBProducts } from "@/ordre/hooks/useNBProducts";
import { osloDateISO } from "@/lib/osloDate";

type RpcResult = {
  order_id?: string;
  order_number?: string;
  status?: string;
  auto_confirmed?: boolean;
  duplicate?: boolean;
  broken_rules?: Array<{ rule: string; message: string; product_id?: string | null }>;
  [k: string]: unknown;
};

type Line = { product_id: string; quantity: number; unit_price?: number };

export default function PortalTest() {
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([{ product_id: "", quantity: 1 }]);
  const [deliveryDate, setDeliveryDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return osloDateISO(d);
  });
  const [distribution, setDistribution] = useState<"pickup" | "delivery">("pickup");
  const [externalId, setExternalId] = useState("");
  const [finalName, setFinalName] = useState("Test Sluttkunde");
  const [finalEmail, setFinalEmail] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RpcResult | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);

  const { data: customers = [] } = useNBCustomers(customerSearch);
  const { data: products = [] } = useNBProducts(productSearch);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId],
  );

  const setLine = (idx: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, { product_id: "", quantity: 1 }]);
  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const canRun =
    !!customerId &&
    !!finalName.trim() &&
    !!deliveryDate &&
    lines.length > 0 &&
    lines.every((l) => l.product_id && l.quantity > 0);

  const run = async () => {
    setRunning(true);
    setResult(null);
    setRawError(null);
    try {
      const payload: Record<string, unknown> = {
        customer_id: customerId,
        distribution,
        delivery_date: deliveryDate,
        final_customer_name: finalName.trim(),
        final_customer_email: finalEmail.trim() || null,
        send_email_confirm: false,
        send_sms_confirm: false,
        lines: lines.map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          ...(l.unit_price != null ? { unit_price: l.unit_price } : {}),
        })),
      };
      if (externalId.trim()) payload.source_external_id = externalId.trim();

      const { data, error } = await supabase.rpc("portal_create_customer_order", {
        p_payload: payload as never,
      });
      if (error) throw error;
      const r = (data ?? {}) as RpcResult;
      setResult(r);
      if (r.duplicate) {
        toast.info("Duplikat oppdaget — eksisterende ordre returnert");
      } else if (r.auto_confirmed) {
        toast.success(`Ordre ${r.order_number ?? ""} auto-bekreftet`);
      } else {
        toast.warning(`Ordre ${r.order_number ?? ""} til aksept-kø`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setRawError(msg);
      toast.error("RPC feilet", { description: msg });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Beaker className="h-6 w-6" />
          Portal-test (STEG 7-verifikasjon)
        </h1>
        <p className="text-sm text-muted-foreground">
          Kjør <code className="font-mono">portal_create_customer_order</code> direkte og se status,
          auto-bekreft-flagg og brutte leveringsregler. Brukes til å verifisere B.1-flyten ende-til-ende.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payload</CardTitle>
          <CardDescription>Velg kunde, produkter og leveringsdato — alt går rett inn i RPC-en.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Kunde */}
          <div className="space-y-2">
            <Label>Kunde (NB AS)</Label>
            <Input
              placeholder="Søk kunde…"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
            />
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Velg kunde…" /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.customer_number} — {c.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCustomer && (
              <p className="text-xs text-muted-foreground">
                E-post: {selectedCustomer.primary_contact_email ?? <em>(mangler)</em>}
              </p>
            )}
          </div>

          {/* Sluttkunde */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Sluttkundenavn *</Label>
              <Input value={finalName} onChange={(e) => setFinalName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Sluttkunde-e-post (valgfri)</Label>
              <Input type="email" value={finalEmail} onChange={(e) => setFinalEmail(e.target.value)} />
            </div>
          </div>

          {/* Leveringsdetaljer */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Leveringsdato</Label>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Distribusjon</Label>
              <Select value={distribution} onValueChange={(v: "pickup" | "delivery") => setDistribution(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pickup">Henting</SelectItem>
                  <SelectItem value="delivery">Levering</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>source_external_id (valgfri — for idempotens-test)</Label>
              <Input
                placeholder="f.eks. test-001"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
              />
            </div>
          </div>

          {/* Linjer */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Linjer</Label>
              <Input
                className="max-w-xs"
                placeholder="Søk produkt…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              {lines.map((l, idx) => (
                <div key={idx} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Produkt</Label>
                    <Select value={l.product_id} onValueChange={(v) => setLine(idx, { product_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Velg produkt…" /></SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.code} — {p.display_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">Antall</Label>
                    <Input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) => setLine(idx, { quantity: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLine(idx)}
                    disabled={lines.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-4 w-4 mr-1" /> Legg til linje
              </Button>
            </div>
          </div>

          <div className="pt-2">
            <Button onClick={run} disabled={!canRun || running} variant="brand">
              {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Kjør portal_create_customer_order
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resultat */}
      {(result || rawError) && (
        <Card>
          <CardHeader>
            <CardTitle>Resultat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {rawError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <div className="flex items-center gap-2 font-medium mb-1">
                  <AlertTriangle className="h-4 w-4" /> RPC-feil
                </div>
                <pre className="font-mono text-xs whitespace-pre-wrap">{rawError}</pre>
              </div>
            )}

            {result && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {result.auto_confirmed ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Auto-bekreftet
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <AlertTriangle className="h-3 w-3 mr-1" /> Til aksept-kø
                    </Badge>
                  )}
                  {result.duplicate && <Badge variant="outline">Duplikat (idempotens)</Badge>}
                  {result.status && <Badge variant="outline">status: {result.status}</Badge>}
                  {result.order_number && (
                    <Badge variant="outline">#{result.order_number}</Badge>
                  )}
                  {result.order_id && (
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/ordre/ordrer/${result.order_id}`}>
                        Åpne bestilling <ExternalLink className="h-3 w-3 ml-1" />
                      </Link>
                    </Button>
                  )}
                </div>

                {result.broken_rules && result.broken_rules.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Brutte leveringsregler
                    </div>
                    <ul className="space-y-1 text-sm">
                      {result.broken_rules.map((r, i) => (
                        <li key={i} className="rounded-md border bg-muted/40 p-2">
                          <span className="font-mono text-xs text-muted-foreground">{r.rule}</span>
                          <div>{r.message}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Rå JSON-respons
                  </div>
                  <pre className="rounded-md border bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap overflow-auto">
{JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
