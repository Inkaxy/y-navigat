import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/ordre/components/ui/status-pill";
import { FileText, Loader2, RefreshCw, Save, Send, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  accessErrorText, callPortal, emptyResponse, formatDeadline, isRfqSubmitReceipt, parseRfqBundle, rfqSubmissionState, uploadPdf,
  type RfqBundle, type RfqResponse,
} from "./portal/portalApi";
import { PortalActionBar, PortalLogin, PortalNotice, PortalShell } from "./portal/PortalShell";

type NumField = "offered_price" | "offered_package_size" | "contract_length_months" | "min_order_volume";
type TextField = "offered_package_unit" | "min_order_unit" | "payment_terms" | "delivery_terms" | "notes" | "datasheet_url";

const SUBMIT_REJECTIONS: Record<string, string> = {
  already_submitted: "Tilbudet er allerede sendt og låst.",
  negotiation_closed: "Forespørselen er avsluttet og tar ikke imot svar.",
  deadline_passed: "Svarfristen er passert.",
  item_not_in_negotiation: "En linje hører ikke til denne forespørselen. Last inn på nytt.",
  invalid_item: "En linje mangler vare. Last inn på nytt.",
};

/** Offentlig tilbudsportal (`/tilbud/:token`). Tilgang krever token + passord på hvert kall. */
export default function SupplierPortal() {
  const { token = "" } = useParams<{ token: string }>();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<RfqBundle | null>(null);
  const [responses, setResponses] = useState<Record<string, RfqResponse>>({});
  // "all" = alle gjeldende linjer innsendt; "partial" = noen linjer innsendt (må kontrolleres internt).
  const [submission, setSubmission] = useState<"none" | "all" | "partial">("none");
  const submitted = submission !== "none";
  const [unknownSave, setUnknownSave] = useState<null | "draft" | "final">(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  // Lenkebytte (ny token) gjør alle pågående svar foreldet.
  const epoch = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    epoch.current += 1;
    busy.current = false;
    setBundle(null); setResponses({}); setSubmission("none"); setUnknownSave(null); setPassword(""); setError(null); setLoading(false); setUploading({}); setSaving(false);
    // Avmontering/lenkebytte: pågående kall er foreldet og ny signert PUT startes ikke.
    return () => { epoch.current += 1; };
  }, [token]);
  const bundleRef = useRef<RfqBundle | null>(null);
  bundleRef.current = bundle;
  // Oppdateres hver render: sene opplastinger legges bare til et fortsatt redigerbart skjema.
  const editableRef = useRef(false);

  async function load(e?: FormEvent) {
    e?.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const my = epoch.current;
    setLoading(true); setError(null);
    const out = await callPortal("validate-rfq-access", { token, password });
    if (my !== epoch.current) return;
    busy.current = false;
    setLoading(false);
    const parsed = out.kind === "ok" ? parseRfqBundle(out.body) : null;
    // Feilet eller ufullstendig lesing: forrige kladd og ukjent-lås beholdes, årsaken vises.
    if (!parsed) { setError(accessErrorText(out)); return; }
    const prior = bundleRef.current;
    if (prior && (prior.recipient_id !== parsed.recipient_id || prior.negotiation_id !== parsed.negotiation_id)) {
      setError("Lenken svarer nå for en annen mottaker eller forespørsel. Last siden på nytt.");
      return;
    }
    const state = rfqSubmissionState(parsed.items, parsed.responses);
    setResponses((prev) => {
      const map: Record<string, RfqResponse> = {};
      for (const it of parsed.items) {
        const existing = parsed.responses.find((r) => r.negotiation_item_id === it.id);
        // Ved avstemming i samme kontekst beholdes leverandørens siste redigerte verdier så lenge
        // ingen linje er innsendt; innsendte/delvise svar vises slik serveren har dem.
        map[it.id] = prior && state === "none" && prev[it.id] ? prev[it.id] : existing ?? emptyResponse(it.id);
      }
      return map;
    });
    // Vellykket lesing er dagens status, ikke en kvittering for forrige operasjon.
    setBundle(parsed); setSubmission(state); setUnknownSave(null);
  }

  const setNum = (id: string, f: NumField, v: string) =>
    setResponses((p) => ({ ...p, [id]: { ...p[id], [f]: v === "" ? null : Number(v) } }));
  const setText = (id: string, f: TextField, v: string | null) =>
    setResponses((p) => ({ ...p, [id]: { ...p[id], [f]: v } }));

  async function handleUpload(itemId: string, file: File) {
    if (!editableRef.current) return;
    const my = epoch.current;
    setUploading((u) => ({ ...u, [itemId]: true }));
    const path = await uploadPdf("request-rfq-datasheet-upload", { token, password }, itemId, file, () => my === epoch.current);
    if (my !== epoch.current || path === "cancelled") return;
    setUploading((u) => ({ ...u, [itemId]: false }));
    if (!path) { toast.error("Opplasting feilet. Prøv igjen."); return; }
    if (!editableRef.current) { toast.error("Skjemaet er låst. Vedlegget ble ikke lagt til."); return; }
    setText(itemId, "datasheet_url", path);
    toast.success(`Lastet opp: ${file.name}`);
  }

  async function save(finalize: boolean) {
    if (busy.current || submitted || unknownSave) return;
    if (Object.values(uploading).some(Boolean)) { toast.error("Vent til opplastingen er ferdig."); return; }
    if (finalize && !confirm("Er du sikker? Etter sending kan du ikke endre tilbudet uten å kontakte oss.")) return;
    busy.current = true;
    const my = epoch.current;
    setLoading(true);
    setSaving(true);
    // Frosset øyeblikksbilde; skjemaet er låst mens lagringen pågår.
    const snapshot = Object.values(responses).map((r) => ({ ...r }));
    const out = await callPortal("submit-negotiation-response", { token, password, finalize, responses: snapshot });
    if (my !== epoch.current) return;
    busy.current = false;
    setLoading(false); setSaving(false);
    if (out.kind === "ok" && isRfqSubmitReceipt(out.body, finalize)) {
      if (finalize) { setSubmission("all"); toast.success("Tilbud sendt. Takk!"); } else toast.success("Kladd lagret");
      return;
    }
    if (out.kind === "rejected") {
      // Avvist som allerede sendt: dette er ikke en kvittering; les status for å vise faktisk tilstand.
      if (out.code === "already_submitted") setUnknownSave("final");
      toast.error((out.code && SUBMIT_REJECTIONS[out.code]) || "Lagring ble avvist.");
      return;
    }
    // Uklart: kan være lagret/sendt. Lås skjemaet til status er lest på nytt — aldri automatisk nytt kall.
    setUnknownSave(finalize ? "final" : "draft");
  }

  if (!bundle) {
    return <PortalLogin title="Tilbudsportal" hint="Passordet er sendt til deg på e-post fra Nøtterø Bakeri."
      password={password} onPassword={setPassword} onSubmit={load} loading={loading} error={error} />;
  }

  const locked = submitted || unknownSave !== null || saving;
  editableRef.current = !locked;
  const anyUploading = Object.values(uploading).some(Boolean);
  return (
    <PortalShell eyebrow="Tilbudsforespørsel" title={bundle.negotiation_title ?? "Forespørsel"}
      status={submission === "all" ? <StatusPill label="Sendt — låst" tokenVar="--state-success" size="md" />
        : submission === "partial" ? <StatusPill label="Delvis sendt — må kontrolleres" tokenVar="--state-warning" size="md" /> : <StatusPill label="Åpen for svar" tokenVar="--state-info" size="md" />}
      meta={<>{bundle.supplier_name ?? "Leverandør"} · Svarfrist {formatDeadline(bundle.response_deadline)}</>}>
      {error && <PortalNotice tone="error">Status kunne ikke leses: {error} Skjemaet forblir låst.</PortalNotice>}
      {submission === "partial" && (
        <PortalNotice tone="warning">
          Bare noen av linjene er registrert som sendt. Skjemaet er låst; resten kan ikke sendes herfra før
          Nøtterø Bakeri har kontrollert og låst opp forespørselen. Ta kontakt med oss.
        </PortalNotice>
      )}
      {unknownSave && (
        <PortalNotice tone="warning" action={
          <Button variant="outline" className="h-[44px]" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Les status på nytt
          </Button>}>
          {unknownSave === "final" ? "Vi vet ikke om tilbudet ble sendt" : "Vi vet ikke om kladden ble lagret"} — svaret kom ikke fram.
          Skjemaet er låst til status er lest på nytt. Ingenting sendes automatisk igjen.
        </PortalNotice>
      )}
      {!submitted && !unknownSave && (
        <p className="text-body text-ink-secondary">Prisen gjelder pakningen du oppgir. Oppgir du ingen pakning, gjelder prisen per grunnenhet (for eksempel kg). Fyll ut det du kan, lagre kladd underveis, og send når tilbudet er komplett.</p>
      )}
      {bundle.items.length === 0 && <PortalNotice tone="info">Forespørselen har ingen varelinjer.</PortalNotice>}

      {bundle.items.map((it) => {
        const r = responses[it.id] ?? emptyResponse(it.id);
        const name = it.rm_name ?? "Råvare";
        const base = it.base_unit ?? "";
        const fid = (f: string) => `rfq-${it.id}-${f}`;
        return (
          <section key={it.id} aria-labelledby={fid("title")} className="space-y-4 rounded-[10px] border border-line-subtle bg-surface-raised p-4 sm:p-5">
            <div>
              <h2 id={fid("title")} className="text-title font-semibold text-ink-primary">{name}</h2>
              <p className="text-body text-ink-secondary">
                Forventet årsvolum: {it.expected_annual_volume ?? "—"} {it.expected_annual_volume_unit ?? base}
                {it.suggested_package_size != null && <> · Foreslått pakning {it.suggested_package_size} {it.suggested_package_unit ?? ""}</>}
              </p>
            </div>
            <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">Tilbud for {name}</legend>
              <div className="space-y-1.5">
                <Label htmlFor={fid("price")}>Pris per pakning (NOK, eks. mva)</Label>
                <Input id={fid("price")} type="number" inputMode="decimal" step="0.01" className="h-[44px]"
                  aria-describedby={fid("price-hint")}
                  value={r.offered_price ?? ""} onChange={(e) => setNum(it.id, "offered_price", e.target.value)} />
                <p id={fid("price-hint")} className="text-caption text-ink-secondary">Uten pakning: pris per {base || "grunnenhet"}.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={fid("pkg")}>Pakningsstørrelse og enhet</Label>
                <div className="flex gap-2">
                  <Input id={fid("pkg")} type="number" inputMode="decimal" step="0.01" className="h-[44px] min-w-0 flex-1"
                    value={r.offered_package_size ?? ""} onChange={(e) => setNum(it.id, "offered_package_size", e.target.value)} />
                  <Input aria-label={`Pakningsenhet for ${name}`} className="h-[44px] w-28" placeholder={base || "kg"}
                    value={r.offered_package_unit ?? ""} onChange={(e) => setText(it.id, "offered_package_unit", e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={fid("months")}>Kontraktslengde (måneder)</Label>
                <Input id={fid("months")} type="number" inputMode="numeric" className="h-[44px]"
                  value={r.contract_length_months ?? ""} onChange={(e) => setNum(it.id, "contract_length_months", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={fid("min")}>Minste ordrevolum og enhet</Label>
                <div className="flex gap-2">
                  <Input id={fid("min")} type="number" inputMode="decimal" step="0.01" className="h-[44px] min-w-0 flex-1"
                    value={r.min_order_volume ?? ""} onChange={(e) => setNum(it.id, "min_order_volume", e.target.value)} />
                  <Input aria-label={`Enhet for minste ordrevolum, ${name}`} className="h-[44px] w-28" placeholder={base}
                    value={r.min_order_unit ?? ""} onChange={(e) => setText(it.id, "min_order_unit", e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={fid("pay")}>Betalingsbetingelser</Label>
                <Input id={fid("pay")} className="h-[44px]" placeholder="Netto 30 dager"
                  value={r.payment_terms ?? ""} onChange={(e) => setText(it.id, "payment_terms", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={fid("del")}>Leveringsbetingelser</Label>
                <Input id={fid("del")} className="h-[44px]" placeholder="DDP, 1 levering/uke"
                  value={r.delivery_terms ?? ""} onChange={(e) => setText(it.id, "delivery_terms", e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <span className="text-sm font-medium" id={fid("ds")}>Datablad / deklarasjon / næringsinnhold (PDF)</span>
                {r.datasheet_url ? (
                  <div className="flex items-center justify-between gap-2 rounded-[10px] border border-line-subtle bg-surface-sunken px-3 text-body">
                    <span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-ink-secondary" aria-hidden />
                      <span className="truncate">{r.datasheet_url.split("/").pop()}</span></span>
                    {!locked && (
                      <Button variant="ghost" className="h-[44px] w-[44px] p-0" aria-label={`Fjern datablad for ${name}`}
                        onClick={() => setText(it.id, "datasheet_url", null)}><X className="h-4 w-4" /></Button>
                    )}
                  </div>
                ) : (
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-line-subtle px-3 text-body text-ink-secondary hover:bg-surface-sunken has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
                    {uploading[it.id] ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                    <span>{uploading[it.id] ? "Laster opp …" : "Last opp PDF"}</span>
                    <input type="file" accept="application/pdf" className="sr-only" aria-labelledby={fid("ds")}
                      disabled={locked || uploading[it.id] === true}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(it.id, f); e.target.value = ""; }} />
                  </label>
                )}
                <p className="text-caption text-ink-secondary">Vedlegg datablad med deklarasjon, næringsinnhold og allergener for tilbudt vare.</p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={fid("notes")}>Notater</Label>
                <Textarea id={fid("notes")} rows={2} value={r.notes ?? ""} onChange={(e) => setText(it.id, "notes", e.target.value)} />
              </div>
            </fieldset>
          </section>
        );
      })}

      {!locked && bundle.items.length > 0 && (
        <PortalActionBar>
          <Button variant="outline" className="h-[44px]" onClick={() => void save(false)} disabled={loading || anyUploading}>
            <Save className="mr-2 h-4 w-4" aria-hidden /> Lagre kladd
          </Button>
          <Button className="h-[44px]" onClick={() => void save(true)} disabled={loading || anyUploading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />} Send tilbud
          </Button>
        </PortalActionBar>
      )}
    </PortalShell>
  );
}
