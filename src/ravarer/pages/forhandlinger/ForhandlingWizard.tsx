import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, ArrowRight, Send, Loader2, Copy, CheckCircle2, Handshake } from "lucide-react";
import { toast } from "sonner";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { useAllRawMaterialPurchaseStats } from "@/ravarer/hooks/usePurchaseStats";
import { baselineFromStats, type BaselineStats } from "@/ravarer/lib/negotiationOps";
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
import { UnitPriceHint } from "@/ravarer/components/forhandlinger/UnitPriceHint";
import { osloDateISO } from "@/lib/osloDate";
import { Link } from "react-router-dom";
import { paths } from "@/ravarer/lib/paths";
import { parseRfqCredentials, isKnownRejection, sameItemSet, canReplaceNegotiationItems, type RfqCredential } from "@/ravarer/lib/negotiationOps";

type Step = 1 | 2 | 3 | 4 | 5;

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: "Grunninfo" },
  { n: 2, label: "Råvarer" },
  { n: 3, label: "Leverandører" },
  { n: 4, label: "E-post" },
  { n: 5, label: "Generer lenker" },
];

export default function ForhandlingWizard() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id?: string }>();
  const [negotiationId, setNegotiationId] = useState<string | null>(routeId ?? null);
  const [step, setStep] = useState<Step>(1);
  const rights = useInvoiceRights();

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
      const created = await createMut.mutateAsync(patch);
      setNegotiationId(created.id);
    }
  }

  // ---- step 2 ----
  const { data: rawMaterials = [] } = useRawMaterials();
  const { data: items = [] } = useNegotiationItems(negotiationId ?? undefined);
  const [selectedRm, setSelectedRm] = useState<Set<string>>(new Set());

  // 12-måneders grunnlag fra den felles innkjøpsstatistikken. Volum i grunnenhet
  // utledes som kost / snittpris per grunnenhet; mangler en av dem er grunnlaget ukjent.
  const statsQ = useAllRawMaterialPurchaseStats();
  const statsMap = useMemo(() => {
    const m = new Map<string, BaselineStats>();
    for (const [id, s] of statsQ.data ?? []) m.set(id, baselineFromStats(s));
    return m;
  }, [statsQ.data]);

  useEffect(() => {
    if (items.length > 0 && selectedRm.size === 0) {
      setSelectedRm(new Set(items.map((it) => it.raw_material_id)));
    }
  }, [items]);

  const upsertItems = useUpsertNegotiationItems();
  async function persistStep2() {
    if (!negotiationId) return;
    // Uendret utvalg skriver ingenting (bevarer vare-ID-er og eventuelle svar).
    if (sameItemSet(items, selectedRm)) return;
    const rows = Array.from(selectedRm).map((rmId, idx) => {
      const s = statsMap.get(rmId);
      return {
        raw_material_id: rmId,
        expected_annual_volume: s?.volume ?? null,
        expected_annual_volume_unit: rawMaterials.find((r) => r.id === rmId)?.base_unit ?? null,
        actual_volume_baseline: s?.volume ?? null,
        actual_cost_baseline: s?.cost ?? null,
        actual_avg_price_baseline: s?.avgPrice ?? null,
        sort_order: idx,
      };
    });
    await upsertItems.mutateAsync({ negotiationId, items: rows });
  }

  // ---- step 3 ----
  const { data: suppliers = [] } = useSuppliers();
  const hiddenSupplierCount = useMemo(
    () => suppliers.filter((s) => s.is_active && !s.track_invoice_lines).length,
    [suppliers],
  );
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
  const [credentials, setCredentials] = useState<RfqCredential[] | null>(null);
  /** Ukjent utfall: passord kan være rotert. Ingen automatisk nytt forsøk. */
  const [genUnknown, setGenUnknown] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const genLock = useRef(false);
  const itemsLocked = !canReplaceNegotiationItems(existing?.status ?? "draft", recipients);

  async function handleSend() {
    if (!negotiationId || genLock.current) return;
    genLock.current = true;
    const frozenNeg = negotiationId;
    const expected = recipients.map((r) => ({ id: r.id, supplier_id: r.supplier_id }));
    try {
      const res = await generateMut.mutateAsync({ negotiationId: frozenNeg });
      const parsed = parseRfqCredentials(res, expected);
      if (parsed.kind !== "ok") {
        setCredentials(null);
        setGenUnknown(true);
        toast.error("Svaret kunne ikke knyttes sikkert til leverandørene. Passordene kan være endret.");
        return;
      }
      setGenUnknown(false);
      setConfirmRegen(false);
      setCredentials(expected.map((r) => parsed.byRecipient.get(r.id)!));
      toast.success("Lenker generert. Kopier e-postene nedenfor — ingenting er sendt.");
    } catch (e) {
      // Bare en kjent avvisning (4xx) beviser at ingenting ble endret.
      if (!isKnownRejection(e)) setGenUnknown(true);
    } finally {
      genLock.current = false;
    }
  }

  function copyEmail(c: RfqCredential) {
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
    } catch (e) {
      toast.error(`Lagring feilet: ${e instanceof Error ? e.message : "ukjent feil"}`);
    }
  }
  function back() {
    if (step > 1) setStep((s) => (s - 1) as Step);
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 p-4 sm:p-6">
      <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => navigate(negotiationId ? paths.forhandling(negotiationId) : paths.forhandlinger())}>
        <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> {negotiationId ? "Til forhandlingen" : "Forhandlinger"}
      </Button>
      <ModulePage
        eyebrow="Forespørsel"
        title={negotiationId ? "Rediger forhandling" : "Ny forhandling"}
        subtitle="Sett opp forespørselen i fem steg. Ingenting sendes automatisk."
        icon={Handshake}
        embedsPage={false}
      >
      {!rights.loading && !rights.canWrite && (
        <p role="status" className="rounded-md border border-line-subtle bg-surface-muted p-3 text-sm text-ink-secondary">
          Du har lesetilgang. Endringer og lenkegenerering krever skrivetilgang til fakturaer i Råvarer.
        </p>
      )}
      {statsQ.isError && (
        <p role="alert" className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
          Innkjøpsgrunnlaget kunne ikke hentes. Grunnlagstall vises som ukjent.{" "}
          <button type="button" className="min-h-[44px] underline" onClick={() => void statsQ.refetch()}>Prøv igjen</button>
        </p>
      )}

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
            {itemsLocked && (
              <p role="status" className="mt-2 text-warning">
                Lenker er allerede generert. Råvarelista kan ikke endres her, fordi det ville slettet tilbud som er knyttet til varene.
              </p>
            )}
          </div>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted/50 text-xs uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left">Råvare</th>
                  <th className="px-3 py-2 text-right">Volum 12 mnd</th>
                  <th className="hidden px-3 py-2 text-right sm:table-cell">Kostnad 12 mnd</th>
                  <th className="hidden px-3 py-2 text-right sm:table-cell">Snittpris</th>
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
                        <td className="px-1 py-0">
                          <label className="flex h-[44px] w-[44px] cursor-pointer items-center justify-center">
                          <Checkbox
                            checked={checked}
                            disabled={itemsLocked || !rights.canWrite}
                            aria-label={`Velg ${r.name}`}
                            onCheckedChange={(v) => {
                              const next = new Set(selectedRm);
                              if (v) next.add(r.id);
                              else next.delete(r.id);
                              setSelectedRm(next);
                            }}
                          />
                          </label>
                        </td>
                        <td className="px-3 py-2 font-medium text-ink-primary">
                          <div>{r.name}</div>
                          <UnitPriceHint
                            rawMaterialId={r.id}
                            pricePerBase={s?.avgPrice ?? null}
                            baseUnit={r.base_unit}
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s?.volume == null ? "Ukjent" : `${formatNumber(s.volume)} ${r.base_unit ?? ""}`}
                        </td>
                        <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{formatNok(s?.cost)}</td>
                        <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{formatNok(s?.avgPrice)}</td>
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
            Velg leverandører som skal motta forespørsel. Listen viser bare aktive leverandører
            som er merket med «Følg fakturalinjer» — forhandlingen bygger på fakturahistorikken deres.
            {hiddenSupplierCount > 0 && (
              <p className="mt-1">
                {hiddenSupplierCount} leverandører uten «Følg fakturalinjer» vises ikke – slå på under{" "}
                <Link to={paths.leverandorer()} className="underline">
                  Leverandører
                </Link>
                .
              </p>
            )}
          </div>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted/50 text-xs uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left">Leverandør</th>
                  <th className="hidden px-3 py-2 text-left sm:table-cell">E-post</th>
                </tr>
              </thead>
              <tbody>
                {/* Bare leverandører med «Følg fakturalinjer» er med: forhandling bygger på
fakturahistorikk, og uten den finnes verken volum eller prisgrunnlag. */}
                {suppliers
                  .filter((s) => s.is_active && s.track_invoice_lines)
                  .map((s) => {
                    const checked = selectedSup.has(s.id);
                    return (
                      <tr key={s.id} className="border-t border-line-subtle">
                        <td className="px-1 py-0">
                          <label className="flex h-[44px] w-[44px] cursor-pointer items-center justify-center">
                          <Checkbox
                            checked={checked}
                            disabled={!rights.canWrite}
                            aria-label={`Velg ${s.name}`}
                            onCheckedChange={(v) => {
                              const next = new Set(selectedSup);
                              if (v) next.add(s.id);
                              else next.delete(s.id);
                              setSelectedSup(next);
                            }}
                          />
                          </label>
                        </td>
                        <td className="px-3 py-2 font-medium text-ink-primary">
                          {s.name}
                          <div className="break-all text-caption font-normal text-ink-secondary sm:hidden">{s.contact_email ?? "Mangler e-post"}</div>
                        </td>
                        <td className="hidden px-3 py-2 text-ink-secondary sm:table-cell">{s.contact_email ?? "—"}</td>
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
              <p className="text-xs text-ink-secondary">
                Appen sender ingen e-post. Du kopierer e-posten per leverandør og sender den selv.
                Passordet gjelder i 5 minutter fra det lages.
              </p>
              {genUnknown && (
                <div role="alert" className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                  <p>
                    Utfallet er ukjent. Noen eller alle passord kan allerede være endret, så tidligere
                    lenker og passord kan være ugyldige. Ingenting prøves på nytt automatisk.
                  </p>
                  <label className="flex min-h-[44px] items-center gap-2">
                    <Checkbox checked={confirmRegen} onCheckedChange={(v) => setConfirmRegen(!!v)} />
                    Jeg forstår at nye lenker gir alle leverandørene nye passord
                  </label>
                </div>
              )}
              <Button onClick={handleSend} disabled={generateMut.isPending || (genUnknown && !confirmRegen) || recipients.length === 0} className="min-h-[44px] rounded-full">
                {generateMut.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {genUnknown ? "Generer nye lenker" : "Generer lenker"}
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                Passordene vises kun én gang og gjelder i 5 minutter. Ingen e-post er sendt — kopier hver e-post og send den selv.
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
                onClick={() => navigate(paths.forhandling(negotiationId))}
                className="rounded-full"
              >
                Til forhandlingsdetaljer
              </Button>
            </>
          )}
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" className="min-h-[44px]" onClick={back} disabled={step === 1}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Tilbake
        </Button>
        {step < 5 && (
          <Button onClick={next} disabled={createMut.isPending || updateMut.isPending || upsertItems.isPending || upsertRecipients.isPending || !rights.canWrite} className="min-h-[44px] rounded-full">
            Neste <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>
      </ModulePage>
    </div>
  );
}
