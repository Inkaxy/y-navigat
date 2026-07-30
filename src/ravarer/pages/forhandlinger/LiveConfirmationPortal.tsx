import { useState } from "react";
import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Lock,
  Send,
  AlertTriangle,
  CheckCircle2,
  Upload,
  FileCheck,
} from "lucide-react";
import { toast } from "sonner";

const FN_BASE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

interface Item {
  id: string;
  raw_material_id: string;
  live_agreed_price: number | null;
  live_agreed_price_unit: string | null;
  live_agreed_package_size: number | null;
  live_agreed_package_unit: string | null;
  live_agreed_contract_months: number | null;
  live_agreed_min_volume: number | null;
  live_agreed_min_volume_unit: string | null;
  live_status: string;
  raw_materials?: { name: string; base_unit: string };
}

interface State {
  confirmed: boolean;
  supplier_note: string;
  datasheet_path: string | null;
  datasheet_skipped: boolean;
  uploading: boolean;
  uploadedName: string | null;
}

const emptyState = (): State => ({
  confirmed: false,
  supplier_note: "",
  datasheet_path: null,
  datasheet_skipped: false,
  uploading: false,
  uploadedName: null,
});

export default function LiveConfirmationPortal() {
  const { token = "" } = useParams<{ token: string }>();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<any | null>(null);
  const [states, setStates] = useState<Record<string, State>>({});
  const [paymentDays, setPaymentDays] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);

  async function login(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${FN_BASE}/validate-live-confirmation-access`, {
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
          wrong_mode: "Denne lenken hører ikke til en live-forhandling",
        };
        setError(map[data.result] ?? "Tilgang nektet");
        return;
      }
      setBundle(data);
      const s: Record<string, State> = {};
      for (const it of data.items as Item[]) {
        const init = emptyState();
        if (it.live_status === "confirmed") {
          init.confirmed = true;
        }
        s[it.id] = init;
      }
      setStates(s);
      // Restore draft from localStorage if any
      try {
        const draft = localStorage.getItem(`live-confirm-draft-${token}`);
        if (draft) {
          const d = JSON.parse(draft);
          setStates((prev) => ({ ...prev, ...d.states }));
          if (d.paymentDays) setPaymentDays(d.paymentDays);
        }
      } catch {
        /* ignore */
      }
    } catch (err: any) {
      setError(err?.message ?? "Ukjent feil");
    } finally {
      setLoading(false);
    }
  }

  function update(itemId: string, patch: Partial<State>) {
    setStates((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  function saveDraft() {
    try {
      localStorage.setItem(
        `live-confirm-draft-${token}`,
        JSON.stringify({ states, paymentDays }),
      );
      toast.success("Kladd lagret lokalt");
    } catch {
      toast.error("Kunne ikke lagre kladd");
    }
  }

  function confirmAll() {
    const next = { ...states };
    for (const id of Object.keys(next)) {
      next[id] = { ...next[id], confirmed: true };
    }
    setStates(next);
  }

  async function uploadDatasheet(item: Item, file: File) {
    update(item.id, { uploading: true });
    try {
      const res = await fetch(`${FN_BASE}/request-live-datasheet-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password,
          negotiation_item_id: item.id,
          filename: file.name,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.result !== "ok") {
        toast.error("Kunne ikke forberede opplasting");
        return;
      }
      // Use the signed URL to upload directly
      const uploadRes = await fetch(data.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });
      if (!uploadRes.ok) {
        toast.error("Opplasting feilet");
        return;
      }
      update(item.id, {
        datasheet_path: data.path,
        datasheet_skipped: false,
        uploadedName: file.name,
      });
      toast.success("Datablad lastet opp");
    } catch (e: any) {
      toast.error(e?.message ?? "Opplasting feilet");
    } finally {
      update(item.id, { uploading: false });
    }
  }

  async function submitAll() {
    // Allerede låste linjer kan ikke redigeres — de skal hverken valideres eller sendes på nytt.
    const editable = (bundle.items as Item[]).filter((it) => it.live_status !== "confirmed");

    // Validate
    for (const it of editable) {
      const s = states[it.id];
      if (s?.confirmed && !s.datasheet_path && !s.datasheet_skipped) {
        toast.error(
          `Last opp datablad eller huk av "sendes separat" for ${it.raw_materials?.name ?? "linje"}`,
        );
        return;
      }
    }
    if (!editable.length) {
      toast.info("Alle linjer er allerede bekreftet og låst.");
      return;
    }
    if (!confirm("Send bekreftelsen? Bekreftede linjer låses.")) return;
    setLoading(true);
    try {
      const items = editable.map((it) => ({
        negotiation_item_id: it.id,
        confirmed: states[it.id].confirmed,
        supplier_note: states[it.id].supplier_note || null,
        datasheet_path: states[it.id].datasheet_path,
        datasheet_skipped: states[it.id].datasheet_skipped,
      }));

      const res = await fetch(`${FN_BASE}/submit-live-confirmation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password,
          items,
          payment_terms_days: paymentDays ? Number(paymentDays) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error("Innsending feilet");
        return;
      }
      setSubmitted(true);
      try {
        localStorage.removeItem(`live-confirm-draft-${token}`);
      } catch {
        /* ignore */
      }
      toast.success(
        data.all_confirmed ? "Alt bekreftet — takk!" : "Bekreftelse sendt",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Innsending feilet");
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
              <h1 className="text-lg font-semibold">Bekreftelse av avtaler</h1>
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
                Passordet er sendt til deg i en separat e-post.
              </p>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6">
          <Card className="w-full p-6 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
            <h1 className="text-lg font-semibold">Takk for bekreftelsen</h1>
            <p className="mt-2 text-sm text-ink-secondary">
              Vi har mottatt din tilbakemelding. Du kan nå lukke vinduet.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  const items = bundle.items as Item[];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-secondary">
            Bekreftelse av avtaler
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {bundle.negotiation_title}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Til: {bundle.supplier_name} · Frist:{" "}
            {bundle.confirmation_deadline
              ? new Date(bundle.confirmation_deadline).toLocaleDateString("nb-NO")
              : "—"}
          </p>
          <p className="mt-2 text-sm text-ink-secondary">
            Vennligst bekreft hver linje. Hvis prisen ikke er korrekt, legg inn et notat
            – avtalen går da tilbake til oss for avklaring.
          </p>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={confirmAll}>
            ✓ Bekreft alle
          </Button>
        </div>

        {items.map((it) => {
          const s = states[it.id] ?? emptyState();
          const rmName = it.raw_materials?.name ?? "Råvare";
          const baseUnit = it.raw_materials?.base_unit ?? "";
          const isLocked = it.live_status === "confirmed";
          return (
            <Card key={it.id} className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-ink-primary">{rmName}</h3>
                  <div className="mt-1 grid gap-1 text-sm text-ink-secondary">
                    <p>
                      Avtalt pris:{" "}
                      <strong className="text-ink-primary">
                        {it.live_agreed_price ?? "—"} {it.live_agreed_price_unit ?? ""}
                      </strong>
                    </p>
                    {it.live_agreed_package_size && (
                      <p>
                        Pakning: {it.live_agreed_package_size}{" "}
                        {it.live_agreed_package_unit ?? ""}
                      </p>
                    )}
                    {it.live_agreed_contract_months && (
                      <p>Avtale: {it.live_agreed_contract_months} måneder</p>
                    )}
                    {it.live_agreed_min_volume && (
                      <p>
                        Min ordre: {it.live_agreed_min_volume}{" "}
                        {it.live_agreed_min_volume_unit ?? baseUnit}
                      </p>
                    )}
                  </div>
                </div>
                {isLocked && (
                  <Badge
                    variant="outline"
                    className="border-success/30 bg-success/10 text-success"
                  >
                    Bekreftet
                  </Badge>
                )}
              </div>

              {!isLocked && (
                <>
                  <label className="flex items-start gap-2 rounded-md border border-line-subtle p-3 text-sm">
                    <Checkbox
                      checked={s.confirmed}
                      onCheckedChange={(v) => update(it.id, { confirmed: !!v })}
                      className="mt-0.5"
                    />
                    <span className="font-medium">Jeg bekrefter denne prisen</span>
                  </label>

                  <div className="space-y-2">
                    <Label>Datablad (PDF)</Label>
                    {s.datasheet_path ? (
                      <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 p-2 text-sm">
                        <FileCheck className="h-4 w-4 text-success" />
                        <span className="flex-1 truncate">{s.uploadedName ?? "Lastet opp"}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            update(it.id, { datasheet_path: null, uploadedName: null })
                          }
                        >
                          Fjern
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex">
                          <input
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            disabled={s.uploading || s.datasheet_skipped}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadDatasheet(it, f);
                              e.target.value = "";
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={s.uploading || s.datasheet_skipped}
                            asChild
                          >
                            <span>
                              {s.uploading ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="mr-2 h-4 w-4" />
                              )}
                              Last opp PDF
                            </span>
                          </Button>
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={s.datasheet_skipped}
                            onCheckedChange={(v) =>
                              update(it.id, { datasheet_skipped: !!v })
                            }
                          />
                          Datablad sendes separat
                        </label>
                      </div>
                    )}
                  </div>

                  <div>
                    <Label>Notater (valgfri)</Label>
                    <Textarea
                      rows={2}
                      value={s.supplier_note}
                      onChange={(e) => update(it.id, { supplier_note: e.target.value })}
                      placeholder="F.eks. avvik fra avtalt pris, leveringskommentar…"
                    />
                  </div>
                </>
              )}
            </Card>
          );
        })}

        <Card className="space-y-2 p-5">
          <h3 className="font-semibold">Generelle vilkår</h3>
          <div>
            <Label>Betalingsbetingelser (dager)</Label>
            <Input
              type="number"
              value={paymentDays}
              onChange={(e) => setPaymentDays(e.target.value)}
              placeholder="30"
              className="max-w-[150px]"
            />
          </div>
        </Card>

        <div className="sticky bottom-4 flex items-center justify-end gap-2 rounded-xl border border-line-subtle bg-surface-raised p-3 shadow-md">
          <Button variant="outline" onClick={saveDraft} disabled={loading}>
            Lagre kladd
          </Button>
          <Button onClick={submitAll} disabled={loading}>
            <Send className="mr-2 h-4 w-4" /> Send bekreftelse
          </Button>
        </div>
      </div>
    </div>
  );
}
