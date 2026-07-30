import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, ArrowRight, Send, Loader2, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useRawMaterials } from "@/ravarer/hooks/useRawMaterials";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import {
  useCreateNegotiation,
  useUpdateNegotiation,
  useNegotiation,
  useNegotiationItems,
  useNegotiationRecipients,
  useUpsertNegotiationItems,
  useUpsertNegotiationRecipients,
  useGenerateRfqCredentials,
} from "@/ravarer/hooks/useNegotiations";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { formatNok, formatNumber } from "@/ravarer/lib/constants";
import { osloDateISO } from "@/lib/osloDate";

type Step = 1 | 2 | 3 | 4 | 5;

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: "Grunninfo" },
  { n: 2, label: "Råvarer" },
  { n: 3, label: "Leverandører" },
  { n: 4, label: "E-post" },
  { n: 5, label: "Send" },
];

export default function ForhandlingWizard() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const [negotiationId, setNegotiationId] = useState<string | null>(routeId ?? null);
  const [step, setStep] = useState<Step>(1);

  // ---- step 1 state ----
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [contractStart, setContractStart] = useState("");
  const [contractEnd, setContractEnd] = useState("");
  const baselineDefaults = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setFullYear(end.getFullYear() - 1);
    return { start: osloDateISO(start), end: osloDateISO(end) };
  }, []);
  const [baselineStart, setBaselineStart] = useState(baselineDefaults.start);
  const [baselineEnd, setBaselineEnd] = useState(baselineDefaults.end);
  const [deadline, setDeadline] = useState("");

  const { data: existing } = useNegotiation(negotiationId ?? undefined);
  useEffect(() => {
    if (!existing) return;
    setTitle(existing.title ?? "");
    setPurpose(existing.purpose ?? "");
    setContractStart(existing.contract_start ?? "");
    setContractEnd(existing.contract_end ?? "");
    if (existing.baseline_period_start) setBaselineStart(existing.baseline_period_start);
    if (existing.baseline_period_end) setBaselineEnd(existing.baseline_period_end);
    if (existing.response_deadline) setDeadline(existing.response_deadline.slice(0, 10));
  }, [existing]);

  const createMut = useCreateNegotiation();
  const updateMut = useUpdateNegotiation();

  async function persistStep1() {
    const patch = {
      title: title.trim() || "Uten tittel",
      purpose: purpose || null,
      contract_start: contractStart || null,
      contract_end: contractEnd || null,
      baseline_period_start: baselineStart || null,
      baseline_period_end: baselineEnd || null,
      response_deadline: deadline ? new Date(deadline).toISOString() : null,
    };
    if (negotiationId) {
      await updateMut.mutateAsync({ id: negotiationId, patch });
    } else {
      const created = await createMut.mutateAsync(patch as any);
      setNegotiationId(created.id);
    }
  }

  // ---- step 2 ----
  const { data: rawMaterials = [] } = useRawMaterials();
  const { data: items = [] } = useNegotiationItems(negotiationId ?? undefined);
  const [selectedRm, setSelectedRm] = useState<Set<string>>(new Set());

  // baseline stats lookup via existing list_raw_material_purchase_stats
  const { legalEntityId } = useRavarer();
  const { data: stats = [] } = useQuery({
    queryKey: ["rm-purchase-stats-365", legalEntityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_raw_material_purchase_stats" as any, {
        p_legal_entity_id: legalEntityId,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const statsMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of stats) m.set(s.raw_material_id, s);
    return m;
  }, [stats]);

  useEffect(() => {
    if (items.length > 0 && selectedRm.size === 0) {
      setSelectedRm(new Set(items.map((it) => it.raw_material_id)));
    }
  }, [items]);

  const upsertItems = useUpsertNegotiationItems();
  async function persistStep2() {
    if (!negotiationId) return;
    const rows = Array.from(selectedRm).map((rmId, idx) => {
      const s = statsMap.get(rmId);
      return {
        raw_material_id: rmId,
        expected_annual_volume: s?.volume_365 ?? null,
        expected_annual_volume_unit: rawMaterials.find((r) => r.id === rmId)?.base_unit ?? null,
        actual_volume_baseline: s?.volume_365 ?? null,
        actual_cost_baseline: s?.cost_365 ?? null,
        actual_avg_price_baseline: s?.avg_price_365 ?? null,
        sort_order: idx,
      };
    });
    await upsertItems.mutateAsync({ negotiationId, items: rows });
  }

  // ---- step 3 ----
  const { data: suppliers = [] } = useSuppliers();
  const { data: recipients = [] } = useNegotiationRecipients(negotiationId ?? undefined);
  const [selectedSup, setSelectedSup] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (recipients.length > 0 && selectedSup.size === 0) {
      setSelectedSup(new Set(recipients.map((r) => r.supplier_id)));
    }
  }, [recipients]);

  const upsertRecipients = useUpsertNegotiationRecipients();
  async function persistStep3() {
    if (!negotiationId) return;
    const rows = Array.from(selectedSup).map((supId) => {
      const sup = suppliers.find((s) => s.id === supId);
      return {
        supplier_id: supId,
        contact_email: sup?.contact_email ?? null,
        contact_name: null,
      };
    });
    await upsertRecipients.mutateAsync({ negotiationId, recipients: rows });
  }

  // ---- step 4 — email template ----
  const [emailIntro, setEmailIntro] = useState(
    "Hei,\n\nVi inviterer dere til å gi tilbud på følgende råvarer for kommende kontraktsperiode. Bruk lenken og passordet nedenfor for å registrere tilbudet.\n\nMed vennlig hilsen,\nNøtterø Bakeri",
  );

  // ---- step 5 — send ----
  const generateMut = useGenerateRfqCredentials();
  const [credentials, setCredentials] = useState<any[] | null>(null);

  async function handleSend() {
    if (!negotiationId) return;
    const res = await generateMut.mutateAsync({ negotiationId });
    setCredentials(res.credentials);
    toast.success("RFQ generert. Kopier e-postene nedenfor.");
  }

  function copyEmail(c: any) {
    const body = `${emailIntro}\n\nLenke: ${c.portal_url}\nPassord: ${c.password}\n`;
    const subject = `RFQ – ${title}`;
    const mail = `Til: ${c.contact_email ?? ""}\nEmne: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(mail);
    toast.success(`E-post kopiert for ${c.supplier_name}`);
  }

  // ---- nav ----
  async function next() {
    try {
      if (step === 1) await persistStep1();
      if (step === 2) await persistStep2();
      if (step === 3) await persistStep3();
      if (step < 5) setStep((s) => (s + 1) as Step);
    } catch (e: any) {
      toast.error(`Lagring feilet: ${e.message ?? e}`);
    }
  }
  function back() {
    if (step > 1) setStep((s) => (s - 1) as Step);
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-6">
      <RavarerHeaderBanner
        title={negotiationId ? "Rediger forhandling" : "Ny forhandling"}
        subtitle="Sett opp RFQ i 5 enkle steg"
      />

      {/* Stepper */}
      <Card className="p-4">
        <ol className="flex flex-wrap items-center gap-2">
          {STEPS.map((s) => {
            const active = s.n === step;
            const done = s.n < step;
            return (
              <li key={s.n} className="flex items-center gap-2">
                <span
                  className={
                    "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold " +
                    (active
                      ? "border-primary bg-primary text-primary-foreground"
                      : done
                      ? "border-success bg-success/10 text-success"
                      : "border-line-strong bg-surface-muted text-ink-secondary")
                  }
                >
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.n}
                </span>
                <span className={active ? "font-medium text-ink-primary" : "text-ink-secondary"}>
                  {s.label}
                </span>
                {s.n < 5 && <span className="mx-1 text-ink-muted">›</span>}
              </li>
            );
          })}
        </ol>
      </Card>

      {/* Step content */}
      {step === 1 && (
        <Card className="space-y-4 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Tittel *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mel-forhandling 2026" />
            </div>
            <div>
              <Label>Svarfrist</Label>
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>Formål / bakgrunn</Label>
              <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} />
            </div>
            <div>
              <Label>Kontrakt fra</Label>
              <Input type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} />
            </div>
            <div>
              <Label>Kontrakt til</Label>
              <Input type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} />
            </div>
            <div>
              <Label>Baseline-periode fra</Label>
              <Input type="date" value={baselineStart} onChange={(e) => setBaselineStart(e.target.value)} />
            </div>
            <div>
              <Label>Baseline-periode til</Label>
              <Input type="date" value={baselineEnd} onChange={(e) => setBaselineEnd(e.target.value)} />
            </div>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line-subtle p-4 text-sm text-ink-secondary">
            Velg råvarer som skal inngå i RFQ. Baseline-tall kommer fra siste 12 måneder.
          </div>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted/50 text-xs uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left">Råvare</th>
                  <th className="px-3 py-2 text-right">Volum 12 mnd</th>
                  <th className="px-3 py-2 text-right">Kostnad 12 mnd</th>
                  <th className="px-3 py-2 text-right">Snittpris</th>
                </tr>
              </thead>
              <tbody>
                {rawMaterials
                  .filter((r) => r.is_active)
                  .map((r) => {
                    const s = statsMap.get(r.id);
                    const checked = selectedRm.has(r.id);
                    return (
                      <tr key={r.id} className="border-t border-line-subtle">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              const next = new Set(selectedRm);
                              if (v) next.add(r.id);
                              else next.delete(r.id);
                              setSelectedRm(next);
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-ink-primary">{r.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatNumber(s?.volume_365)} {r.base_unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNok(s?.cost_365)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNok(s?.avg_price_365)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line-subtle p-3 text-xs text-ink-secondary">
            {selectedRm.size} råvarer valgt
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line-subtle p-4 text-sm text-ink-secondary">
            Velg leverandører som skal motta forespørsel.
          </div>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted/50 text-xs uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left">Leverandør</th>
                  <th className="px-3 py-2 text-left">E-post</th>
                </tr>
              </thead>
              <tbody>
                {suppliers
                  .filter((s) => s.is_active)
                  .map((s) => {
                    const checked = selectedSup.has(s.id);
                    return (
                      <tr key={s.id} className="border-t border-line-subtle">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              const next = new Set(selectedSup);
                              if (v) next.add(s.id);
                              else next.delete(s.id);
                              setSelectedSup(next);
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-ink-primary">{s.name}</td>
                        <td className="px-3 py-2 text-ink-secondary">{s.contact_email ?? "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line-subtle p-3 text-xs text-ink-secondary">
            {selectedSup.size} leverandører valgt
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card className="space-y-3 p-6">
          <Label>E-post-tekst (lim inn i e-postklienten din)</Label>
          <Textarea rows={10} value={emailIntro} onChange={(e) => setEmailIntro(e.target.value)} />
          <p className="text-xs text-ink-secondary">
            Lenken og passordet legges automatisk til nederst per leverandør i steg 5.
          </p>
        </Card>
      )}

      {step === 5 && (
        <Card className="space-y-4 p-6">
          {!credentials ? (
            <>
              <h3 className="font-semibold text-ink-primary">Klar til å sende</h3>
              <ul className="space-y-1 text-sm text-ink-secondary">
                <li>• {selectedRm.size} råvarer</li>
                <li>• {selectedSup.size} leverandører</li>
                <li>• Frist: {deadline || "ikke satt"}</li>
              </ul>
              <Button onClick={handleSend} disabled={generateMut.isPending} className="rounded-full">
                {generateMut.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Generer passord og lenker
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                Passordene vises kun én gang og utløper om 5 minutter. Kopier e-postene nå.
              </div>
              <div className="space-y-2">
                {credentials.map((c) => (
                  <div
                    key={c.recipient_id}
                    className="flex items-center justify-between gap-3 rounded-md border border-line-subtle bg-surface-raised p-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-ink-primary">{c.supplier_name}</div>
                      <div className="truncate text-xs text-ink-secondary">{c.contact_email ?? "(mangler e-post)"}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        <Badge variant="outline">Passord: {c.password}</Badge>
                        <span className="truncate text-ink-secondary">{c.portal_url}</span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => copyEmail(c)}>
                      <Copy className="mr-1.5 h-3.5 w-3.5" /> Kopier e-post
                    </Button>
                  </div>
                ))}
              </div>
              <Separator />
              <Button
                variant="outline"
                onClick={() => navigate(`/ravarer/forhandlinger/${negotiationId}`)}
                className="rounded-full"
              >
                Til forhandlingsdetaljer
              </Button>
            </>
          )}
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={back} disabled={step === 1}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Tilbake
        </Button>
        {step < 5 && (
          <Button onClick={next} disabled={createMut.isPending || updateMut.isPending} className="rounded-full">
            Neste <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
