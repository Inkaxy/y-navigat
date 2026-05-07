import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Lock, Send, Save, AlertTriangle, Upload, FileText, X } from "lucide-react";
import { toast } from "sonner";

type Item = {
  id: string;
  raw_material_id: string;
  expected_annual_volume: number | null;
  expected_annual_volume_unit: string | null;
  suggested_package_size: number | null;
  suggested_package_unit: string | null;
  raw_materials?: { name: string; base_unit: string; package_size: number | null; package_unit: string | null };
};

type ResponseRow = {
  negotiation_item_id: string;
  offered_price?: number | null;
  offered_package_size?: number | null;
  offered_package_unit?: string | null;
  contract_length_months?: number | null;
  min_order_volume?: number | null;
  min_order_unit?: string | null;
  payment_terms?: string | null;
  delivery_terms?: string | null;
  notes?: string | null;
  status?: string;
};

const FN_BASE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

export default function SupplierPortal() {
  const { token = "" } = useParams<{ token: string }>();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<any | null>(null);
  const [responses, setResponses] = useState<Record<string, ResponseRow>>({});
  const [submitted, setSubmitted] = useState(false);

  async function login(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${FN_BASE}/validate-rfq-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok || data.result !== "ok") {
        const map: Record<string, string> = {
          invalid_token: "Ugyldig lenke",
          wrong_password: "Feil passord",
          locked: "Tilgang midlertidig låst (for mange forsøk)",
          expired: "Lenken er utløpt",
          rate_limited: "For mange forsøk – vent litt før du prøver igjen",
        };
        setError(map[data.result] ?? "Tilgang nektet");
        return;
      }
      setBundle(data);
      const map: Record<string, ResponseRow> = {};
      for (const it of data.items as Item[]) {
        const existing = (data.responses ?? []).find((r: any) => r.negotiation_item_id === it.id);
        map[it.id] = existing ?? { negotiation_item_id: it.id };
        if (existing?.status === "submitted") setSubmitted(true);
      }
      setResponses(map);
    } catch (err: any) {
      setError(err?.message ?? "Ukjent feil");
    } finally {
      setLoading(false);
    }
  }

  function update(itemId: string, field: keyof ResponseRow, value: any) {
    setResponses((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }));
  }

  async function handleUpload(itemId: string, file: File) {
    try {
      const res = await fetch(`${FN_BASE}/request-rfq-datasheet-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, negotiation_item_id: itemId, filename: file.name }),
      });
      const data = await res.json();
      if (!res.ok || data.result !== "ok") {
        toast.error("Kunne ikke starte opplasting");
        return;
      }
      const put = await fetch(data.signedUrl ?? data.signed_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });
      if (!put.ok) {
        toast.error("Opplasting feilet");
        return;
      }
      update(itemId, "datasheet_url", data.path);
      toast.success(`Lastet opp: ${file.name}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Opplasting feilet");
    }
  }

  async function save(finalize: boolean) {
    if (finalize && !confirm("Er du sikker? Etter sending kan du ikke endre tilbudet uten å kontakte oss.")) return;
    setLoading(true);
    try {
      const res = await fetch(`${FN_BASE}/submit-negotiation-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, finalize, responses: Object.values(responses) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.result === "already_submitted" ? "Tilbudet er allerede sendt" : "Lagring feilet");
        if (data.result === "already_submitted") setSubmitted(true);
        return;
      }
      if (finalize) {
        setSubmitted(true);
        toast.success("Tilbud sendt. Takk!");
      } else {
        toast.success("Kladd lagret");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Lagring feilet");
    } finally {
      setLoading(false);
    }
  }

  if (!bundle) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6">
          <Card className="w-full p-6">
            <div className="mb-6 flex items-center gap-2">
              <Lock className="h-5 w-5 text-ink-secondary" />
              <h1 className="text-lg font-semibold">Tilbudsportal</h1>
            </div>
            <form onSubmit={login} className="space-y-4">
              <div>
                <Label>Passord</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="6 tegn"
                  autoFocus
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
              <Button type="submit" disabled={loading || !password} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Logg inn"}
              </Button>
              <p className="text-center text-xs text-ink-secondary">
                Passordet er sendt til deg på e-post fra Nøtterø Bakeri.
              </p>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-secondary">Tilbudsforespørsel</p>
          <h1 className="text-2xl font-semibold tracking-tight">{bundle.negotiation_title}</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {bundle.supplier_name} · Frist: {bundle.response_deadline ? new Date(bundle.response_deadline).toLocaleDateString("nb-NO") : "—"}
          </p>
          {submitted && (
            <Badge variant="outline" className="mt-2 border-success/30 bg-success/10 text-success">
              Sendt — låst
            </Badge>
          )}
        </div>

        {(bundle.items as Item[]).map((it) => {
          const r = responses[it.id] ?? { negotiation_item_id: it.id };
          const rmName = it.raw_materials?.name ?? "Råvare";
          const baseUnit = it.raw_materials?.base_unit ?? "";
          return (
            <Card key={it.id} className="space-y-4 p-5">
              <div>
                <h3 className="font-semibold text-ink-primary">{rmName}</h3>
                <p className="text-sm text-ink-secondary">
                  Forventet årsvolum: {it.expected_annual_volume ?? "—"} {it.expected_annual_volume_unit ?? baseUnit}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Pris pr {baseUnit || "enhet"} (NOK)</Label>
                  <Input type="number" step="0.01" disabled={submitted}
                    value={r.offered_price ?? ""}
                    onChange={(e) => update(it.id, "offered_price", e.target.value === "" ? null : Number(e.target.value))} />
                </div>
                <div>
                  <Label>Pakningsstørrelse</Label>
                  <div className="flex gap-2">
                    <Input type="number" step="0.01" disabled={submitted}
                      value={r.offered_package_size ?? ""}
                      onChange={(e) => update(it.id, "offered_package_size", e.target.value === "" ? null : Number(e.target.value))} />
                    <Input className="w-24" disabled={submitted}
                      value={r.offered_package_unit ?? ""} placeholder="sekk"
                      onChange={(e) => update(it.id, "offered_package_unit", e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Kontraktslengde (mnd)</Label>
                  <Input type="number" disabled={submitted}
                    value={r.contract_length_months ?? ""}
                    onChange={(e) => update(it.id, "contract_length_months", e.target.value === "" ? null : Number(e.target.value))} />
                </div>
                <div>
                  <Label>Min. ordrevolum</Label>
                  <div className="flex gap-2">
                    <Input type="number" step="0.01" disabled={submitted}
                      value={r.min_order_volume ?? ""}
                      onChange={(e) => update(it.id, "min_order_volume", e.target.value === "" ? null : Number(e.target.value))} />
                    <Input className="w-24" disabled={submitted}
                      value={r.min_order_unit ?? ""} placeholder={baseUnit}
                      onChange={(e) => update(it.id, "min_order_unit", e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Betalingsbetingelser</Label>
                  <Input disabled={submitted} value={r.payment_terms ?? ""}
                    onChange={(e) => update(it.id, "payment_terms", e.target.value)} placeholder="Netto 30 dager" />
                </div>
                <div>
                  <Label>Leveringsbetingelser</Label>
                  <Input disabled={submitted} value={r.delivery_terms ?? ""}
                    onChange={(e) => update(it.id, "delivery_terms", e.target.value)} placeholder="DDP, 1 lev/uke" />
                </div>
                <div className="sm:col-span-2">
                  <Label>Notater</Label>
                  <Textarea rows={2} disabled={submitted} value={r.notes ?? ""}
                    onChange={(e) => update(it.id, "notes", e.target.value)} />
                </div>
              </div>
            </Card>
          );
        })}

        {!submitted && (
          <div className="sticky bottom-4 flex items-center justify-end gap-2 rounded-xl border border-line-subtle bg-surface-raised p-3 shadow-md">
            <Button variant="outline" onClick={() => save(false)} disabled={loading}>
              <Save className="mr-2 h-4 w-4" /> Lagre kladd
            </Button>
            <Button onClick={() => save(true)} disabled={loading}>
              <Send className="mr-2 h-4 w-4" /> Send tilbud
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
