import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, CheckCheck, FileCheck, Loader2, RefreshCw, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { LiveItemStatusPill } from "@/ravarer/components/forhandlinger/NegotiationPills";
import {
  accessErrorText, callPortal, emptyLiveDraft, formatDeadline, formatNok, liveDraftKey, parseLiveBundle,
  parseLiveDraft, parsePaymentDays, uploadPdf, type LiveBundle, type LiveItem, type LiveLineDraft,
} from "./portal/portalApi";
import { PortalActionBar, PortalLogin, PortalNotice, PortalShell } from "./portal/PortalShell";

/** Offentlig bekreftelsesportal (`/bekreftelse/:token`) etter live-forhandling. */
export default function LiveConfirmationPortal() {
  const { token = "" } = useParams<{ token: string }>();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<LiveBundle | null>(null);
  const [states, setStates] = useState<Record<string, LiveLineDraft>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [paymentDays, setPaymentDays] = useState("");
  const [submitted, setSubmitted] = useState<null | { allConfirmed: boolean }>(null);
  const [unknownSubmit, setUnknownSubmit] = useState(false);
  const epoch = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    epoch.current += 1;
    busy.current = false;
    setBundle(null); setStates({}); setPaymentDays(""); setSubmitted(null); setUnknownSubmit(false); setPassword(""); setError(null); setLoading(false);
  }, [token]);

  async function load(e?: FormEvent) {
    e?.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const my = epoch.current;
    setLoading(true); setError(null);
    const out = await callPortal("validate-live-confirmation-access", { token, password });
    if (my !== epoch.current) return;
    busy.current = false;
    setLoading(false);
    const parsed = out.kind === "ok" ? parseLiveBundle(out.body) : null;
    if (!parsed) { setError(accessErrorText(out)); return; }
    const s: Record<string, LiveLineDraft> = {};
    for (const it of parsed.items) s[it.id] = { ...emptyLiveDraft(), confirmed: it.live_status === "confirmed" };
    let restored: ReturnType<typeof parseLiveDraft> = null;
    try {
      restored = parseLiveDraft(localStorage.getItem(liveDraftKey(token)), new Set(parsed.items.map((i) => i.id)));
    } catch (err) {
      console.warn("Lokal kladd kunne ikke leses", err instanceof Error ? err.name : "ukjent");
    }
    if (restored) {
      for (const it of parsed.items) if (it.live_status !== "confirmed" && restored.states[it.id]) s[it.id] = restored.states[it.id];
      setPaymentDays(restored.paymentDays);
    }
    setBundle(parsed); setStates(s); setUnknownSubmit(false);
  }

  const update = (id: string, patch: Partial<LiveLineDraft>) =>
    setStates((p) => ({ ...p, [id]: { ...(p[id] ?? emptyLiveDraft()), ...patch } }));

  function saveDraft() {
    try {
      localStorage.setItem(liveDraftKey(token), JSON.stringify({ states, paymentDays }));
      toast.success("Kladd lagret på denne enheten");
    } catch {
      toast.error("Kunne ikke lagre kladd");
    }
  }

  async function uploadDatasheet(item: LiveItem, file: File) {
    const my = epoch.current;
    setUploading((u) => ({ ...u, [item.id]: true }));
    const path = await uploadPdf("request-live-datasheet-upload", { token, password }, item.id, file);
    if (my !== epoch.current) return;
    setUploading((u) => ({ ...u, [item.id]: false }));
    if (!path) { toast.error("Opplasting feilet. Prøv igjen."); return; }
    update(item.id, { datasheet_path: path, datasheet_skipped: false, uploadedName: file.name });
    toast.success("Datablad lastet opp");
  }

  async function submitAll() {
    if (!bundle || busy.current || unknownSubmit) return;
    // Låste linjer valideres eller sendes aldri på nytt.
    const editable = bundle.items.filter((it) => it.live_status !== "confirmed");
    if (!editable.length) { toast.info("Alle linjer er allerede bekreftet og låst."); return; }
    for (const it of editable) {
      const s = states[it.id];
      if (s?.confirmed && !s.datasheet_path && !s.datasheet_skipped) {
        toast.error(`Last opp datablad eller huk av «sendes separat» for ${it.rm_name ?? "linje"}`);
        return;
      }
    }
    const days = parsePaymentDays(paymentDays);
    if (!days.ok) { toast.error("Betalingsdager må være et helt tall mellom 0 og 365."); return; }
    if (!confirm("Send bekreftelsen? Bekreftede linjer låses.")) return;
    busy.current = true;
    const my = epoch.current;
    setLoading(true);
    const items = editable.map((it) => {
      const s = states[it.id] ?? emptyLiveDraft();
      return { negotiation_item_id: it.id, confirmed: s.confirmed, supplier_note: s.supplier_note || null, datasheet_path: s.datasheet_path, datasheet_skipped: s.datasheet_skipped };
    });
    const out = await callPortal("submit-live-confirmation", { token, password, items, payment_terms_days: days.value });
    if (my !== epoch.current) return;
    busy.current = false;
    setLoading(false);
    if (out.kind === "ok" && out.body.success === true) {
      try { localStorage.removeItem(liveDraftKey(token)); } catch (err) { console.warn("Kladd ble ikke fjernet", err instanceof Error ? err.name : "ukjent"); }
      const all = out.body.all_confirmed === true;
      setSubmitted({ allConfirmed: all });
      toast.success(all ? "Alt bekreftet — takk!" : "Bekreftelse sendt");
      return;
    }
    if (out.kind === "rejected") { toast.error("Innsendingen ble avvist. Last inn på nytt og kontroller linjene."); return; }
    // Uklart utfall: lokal kladd beholdes, skjemaet låses til status er lest på nytt.
    setUnknownSubmit(true);
  }

  if (!bundle) {
    return <PortalLogin title="Bekreftelse av avtaler" hint="Passordet er sendt til deg i en separat e-post."
      password={password} onPassword={setPassword} onSubmit={load} loading={loading} error={error} />;
  }

  if (submitted) {
    return (
      <PortalShell eyebrow="Bekreftelse av avtaler" title={bundle.negotiation_title ?? "Avtaler"}>
        <div role="status" className="space-y-2 rounded-[10px] border border-line-subtle bg-surface-raised p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden />
          <h2 className="text-lg font-semibold">Takk for bekreftelsen</h2>
          <p className="text-body text-ink-secondary">
            {submitted.allConfirmed ? "Alle linjer er bekreftet." : "Vi har mottatt tilbakemeldingen. Linjer som ikke er bekreftet går tilbake til oss for avklaring."} Du kan nå lukke vinduet.
          </p>
        </div>
      </PortalShell>
    );
  }

  const locked = unknownSubmit || loading;
  const open = bundle.items.filter((i) => i.live_status !== "confirmed");
  return (
    <PortalShell eyebrow="Bekreftelse av avtaler" title={bundle.negotiation_title ?? "Avtaler"}
      meta={<>Til {bundle.supplier_name ?? "leverandør"} · Frist {formatDeadline(bundle.confirmation_deadline)}</>}>
      {unknownSubmit ? (
        <PortalNotice tone="warning" action={
          <Button variant="outline" className="h-[44px]" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Les status på nytt
          </Button>}>
          Vi vet ikke om bekreftelsen kom fram. Kladden er beholdt, og skjemaet er låst til status er lest på nytt. Ingenting sendes automatisk igjen.
        </PortalNotice>
      ) : (
        <p className="text-body text-ink-secondary">Bekreft hver linje. Er prisen ikke korrekt, lar du linja stå ubekreftet og skriver et notat — den går da tilbake til oss for avklaring.</p>
      )}

      {open.length > 1 && (
        <div className="flex justify-end">
          <Button variant="outline" className="h-[44px]" disabled={locked}
            onClick={() => setStates((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, confirmed: true }])))}>
            <CheckCheck className="mr-2 h-4 w-4" aria-hidden /> Bekreft alle
          </Button>
        </div>
      )}

      {bundle.items.map((it) => {
        const s = states[it.id] ?? emptyLiveDraft();
        const name = it.rm_name ?? "Råvare";
        const isLocked = it.live_status === "confirmed";
        const fid = (f: string) => `live-${it.id}-${f}`;
        return (
          <section key={it.id} aria-labelledby={fid("title")} className="space-y-4 rounded-[10px] border border-line-subtle bg-surface-raised p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 id={fid("title")} className="text-title font-semibold text-ink-primary">{name}</h2>
              <LiveItemStatusPill status={it.live_status} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body sm:grid-cols-4">
              <div><dt className="text-caption text-ink-secondary">Avtalt pris</dt>
                <dd className="font-semibold tabular-nums">{formatNok(it.live_agreed_price)} {it.live_agreed_price != null ? `kr${it.live_agreed_price_unit ? ` / ${it.live_agreed_price_unit}` : ""}` : ""}</dd></div>
              <div><dt className="text-caption text-ink-secondary">Pakning</dt>
                <dd>{it.live_agreed_package_size != null ? `${it.live_agreed_package_size} ${it.live_agreed_package_unit ?? ""}` : "—"}</dd></div>
              <div><dt className="text-caption text-ink-secondary">Avtaletid</dt>
                <dd>{it.live_agreed_contract_months != null ? `${it.live_agreed_contract_months} mnd` : "—"}</dd></div>
              <div><dt className="text-caption text-ink-secondary">Minste ordre</dt>
                <dd>{it.live_agreed_min_volume != null ? `${it.live_agreed_min_volume} ${it.live_agreed_min_volume_unit ?? it.base_unit ?? ""}` : "—"}</dd></div>
            </dl>

            {!isLocked && (
              <fieldset disabled={locked} className="space-y-3">
                <legend className="sr-only">Bekreftelse for {name}</legend>
                <label htmlFor={fid("ok")} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[10px] border border-line-subtle px-3 text-body">
                  <Checkbox id={fid("ok")} checked={s.confirmed} onCheckedChange={(v) => update(it.id, { confirmed: v === true })} />
                  <span className="font-medium">Jeg bekrefter denne prisen</span>
                </label>
                <div className="space-y-1.5">
                  <span className="text-sm font-medium" id={fid("ds")}>Datablad (PDF)</span>
                  {s.datasheet_path ? (
                    <div className="flex items-center gap-2 rounded-[10px] border border-success/30 bg-success/5 pl-3 text-body">
                      <FileCheck className="h-4 w-4 text-success" aria-hidden />
                      <span className="flex-1 truncate">{s.uploadedName ?? "Lastet opp"}</span>
                      <Button variant="ghost" className="h-[44px]" aria-label={`Fjern datablad for ${name}`}
                        onClick={() => update(it.id, { datasheet_path: null, uploadedName: null })}>Fjern</Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-line-subtle px-4 text-body font-medium hover:bg-surface-sunken has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
                        {uploading[it.id] ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                        {uploading[it.id] ? "Laster opp …" : "Last opp PDF"}
                        <input type="file" accept="application/pdf" className="sr-only" aria-labelledby={fid("ds")}
                          disabled={locked || uploading[it.id] === true || s.datasheet_skipped}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadDatasheet(it, f); e.target.value = ""; }} />
                      </label>
                      <label htmlFor={fid("skip")} className="flex min-h-[44px] cursor-pointer items-center gap-3 px-1 text-body">
                        <Checkbox id={fid("skip")} checked={s.datasheet_skipped} onCheckedChange={(v) => update(it.id, { datasheet_skipped: v === true })} />
                        Datablad sendes separat
                      </label>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={fid("note")}>Notat (valgfritt)</Label>
                  <Textarea id={fid("note")} rows={2} value={s.supplier_note} placeholder="F.eks. avvik fra avtalt pris, leveringskommentar …"
                    onChange={(e) => update(it.id, { supplier_note: e.target.value })} />
                </div>
              </fieldset>
            )}
          </section>
        );
      })}

      <section className="space-y-2 rounded-[10px] border border-line-subtle bg-surface-raised p-4 sm:p-5">
        <h2 className="text-title font-semibold">Generelle vilkår</h2>
        <Label htmlFor="live-payment-days">Betalingsbetingelser (dager)</Label>
        <Input id="live-payment-days" type="number" inputMode="numeric" min={0} max={365} className="h-[44px] max-w-[160px]"
          disabled={locked} value={paymentDays} placeholder="30" onChange={(e) => setPaymentDays(e.target.value)} />
      </section>

      {open.length > 0 && !unknownSubmit && (
        <PortalActionBar>
          <Button variant="outline" className="h-[44px]" onClick={saveDraft} disabled={loading}>Lagre kladd</Button>
          <Button className="h-[44px]" onClick={() => void submitAll()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />} Send bekreftelse
          </Button>
        </PortalActionBar>
      )}
    </PortalShell>
  );
}
