// Samlet gjenlesing: motoren. Ligger utenfor React slik at navigasjon i appen ikke stopper kjøringen; tilstanden
// lagres i localStorage før hvert kall, så omlasting vet nøyaktig hvor den slapp (aldri samme faktura lest to ganger
// i samme kjøring – en påbegynt lesing gjenfinnes og leses ferdig i stedet for å startes på nytt).
// Skriveveien er dagens: rm_begin_invoice_reread → reread-invoice-preview → rm_apply_invoice_reread (som legger
// fakturaen i den vanlige omberegningskøen). Ingen annen rematch startes herfra.
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { decideApply, fetchRereadRun } from "@/fakturaer/hooks/useInvoiceReread";
import type { Operation } from "@/fakturaer/lib/reread";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { autoInputFromRun, decideAuto } from "@/ravarer/lib/samletGjenlesing/rule";
import { callPendingRpc } from "@/lib/pendingRpc";
import type { SkipReason } from "@/ravarer/lib/samletGjenlesing/plan";
import {
  CONCURRENCY, MAX_ATTEMPTS, afterReload, autoApplyReason, backoffMs, classifyFailure, leaseKey, otherTabOwns, parseLease,
  parseState, runCounts, storageKey, type BulkRunState, type Outcome, type RunItem,
} from "@/ravarer/lib/samletGjenlesing/runState";

const PREVIEW_TIMEOUT_MS = 170_000;
const POLL_MS = 4_000;
const SHORT_WAIT_MS = 20_000;
const LONG_WAIT_MS = 120_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type RawRun = { id: string; status: string; error_code: string | null; snapshot: Json; proposal: Json | null };
type InvokeResult = { returned: boolean; httpStatus: number | null; code: string | null };

export type RunnerSnapshot = {
  state: BulkRunState | null;
  otherTab: boolean;
  active: boolean;
  cooldownUntil: number;
  ctx: { le: string; uid: string } | null;
};

class SamletRunner {
  private ctx: { le: string; uid: string } | null = null;
  private qc: QueryClient | null = null;
  private readonly tabId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
  private state: BulkRunState | null = null;
  private otherTab = false;
  private workers = 0;
  private cooldownUntil = 0;
  private consecutive = 0;
  private inFlight = new Set<string>();
  private invokes = new Map<string, InvokeResult>();
  private applyRetried = new Set<string>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private snap: RunnerSnapshot = { state: null, otherTab: false, active: false, cooldownUntil: 0, ctx: null };
  private lastInvalidate = 0;
  /** Erstatning (fjerner rester) bare når 20261123_gjenlesing_fjern_linjer er kjørt. Feil/ukjent = dagens regel. */
  private replaceMode: Promise<boolean> | null = null;
  private replaceAllowed(): Promise<boolean> {
    this.replaceMode ??= callPendingRpc("rm_cap_gjenlesing_fjern_v1", {}).then((r) => r.kind === "ok" && r.data === true).catch(() => false);
    return this.replaceMode;
  }

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getSnapshot = () => this.snap;

  private emit() {
    this.snap = { state: this.state, otherTab: this.otherTab, active: this.workers > 0, cooldownUntil: this.cooldownUntil, ctx: this.ctx };
    for (const l of this.listeners) { try { l(); } catch (e) { console.error("[samlet-gjenlesing] lytter", e); } }
  }

  /** Bind til innlogget bruker + selskap. En aktiv kjøring beholder sitt opprinnelige selskap. */
  attach(le: string, uid: string, qc: QueryClient) {
    this.qc = qc;
    if (this.workers > 0) return;
    if (this.ctx?.le === le && this.ctx.uid === uid) return;
    this.ctx = { le, uid };
    this.reload();
  }

  /** Les lagret tilstand (også når en annen fane har skrevet). */
  reload() {
    if (!this.ctx || this.workers > 0) return;
    const { le, uid } = this.ctx;
    const parsed = parseState(localStorage.getItem(storageKey(le, uid)), le, uid);
    const lease = parseLease(localStorage.getItem(leaseKey(le, uid)));
    this.otherTab = !!parsed && parsed.status === "running" && otherTabOwns(lease, this.tabId, Date.now());
    this.state = parsed && !this.otherTab ? afterReload(parsed) : parsed;
    if (parsed && this.state !== parsed) this.save();
    else this.emit();
  }

  private save() {
    if (this.ctx && this.state) {
      try { localStorage.setItem(storageKey(this.ctx.le, this.ctx.uid), JSON.stringify(this.state)); } catch (e) { console.error("[samlet-gjenlesing] lagring", e); }
    }
    this.emit();
  }

  private get(id: string): RunItem | undefined { return this.state?.items.find((i) => i.invoiceId === id); }
  private update(id: string, patch: Partial<RunItem>) {
    if (!this.state) return;
    this.state = { ...this.state, items: this.state.items.map((i) => (i.invoiceId === id ? { ...i, ...patch } : i)) };
    this.save();
  }

  start(items: { invoiceId: string; label: string }[], plannedSkips: Partial<Record<SkipReason, number>>, dateLabel: string) {
    if (!this.ctx || this.workers > 0 || this.otherTab) return;
    if (this.state && (this.state.status === "running" || this.state.status === "paused")) return;
    this.state = {
      v: 1, id: crypto.randomUUID(), legalEntityId: this.ctx.le, userId: this.ctx.uid, startedAt: new Date().toISOString(), dateLabel,
      status: "running", pauseReason: null, plannedSkips,
      items: items.map((i) => ({ invoiceId: i.invoiceId, label: i.label, phase: "queued", runId: null, attempts: 0, beginAt: null, outcome: null, code: null, ops: null, note: null })),
    };
    this.consecutive = 0; this.cooldownUntil = 0; this.applyRetried.clear(); this.invokes.clear();
    this.save();
    this.kick();
  }

  pause(reason: string | null = null) {
    if (!this.state || this.state.status !== "running") return;
    this.state = { ...this.state, status: "paused", pauseReason: reason };
    this.save();
  }
  resume() {
    if (!this.state || this.otherTab || (this.state.status !== "paused")) return;
    this.state = { ...this.state, status: "running", pauseReason: null };
    this.save();
    this.kick();
  }
  stop() {
    if (!this.state || (this.state.status !== "running" && this.state.status !== "paused")) return;
    this.state = { ...this.state, status: "stopped", pauseReason: null };
    this.save();
    if (this.workers === 0) this.summaryAudit();
  }
  /** Lukk kvitteringen (bare når ingenting pågår). */
  clear() {
    if (!this.ctx || this.workers > 0 || !this.state || this.state.status === "running" || this.state.status === "paused") return;
    localStorage.removeItem(storageKey(this.ctx.le, this.ctx.uid));
    this.state = null;
    this.emit();
  }

  private kick() {
    if (!this.ctx || !this.state || this.state.status !== "running") return;
    const lease = parseLease(localStorage.getItem(leaseKey(this.ctx.le, this.ctx.uid)));
    if (otherTabOwns(lease, this.tabId, Date.now())) { this.otherTab = true; this.emit(); return; }
    this.beat();
    if (!this.heartbeat) this.heartbeat = setInterval(() => this.beat(), 5_000);
    while (this.workers < CONCURRENCY) { this.workers++; void this.worker(); }
    this.emit();
  }
  private beat() { if (this.ctx) localStorage.setItem(leaseKey(this.ctx.le, this.ctx.uid), JSON.stringify({ tabId: this.tabId, at: Date.now() })); }

  private async worker() {
    try {
      while (this.state?.status === "running") {
        while (Date.now() < this.cooldownUntil && this.state?.status === "running") await sleep(Math.min(1_000, this.cooldownUntil - Date.now()));
        if (this.state?.status !== "running") break;
        const item = this.state.items.find((i) => i.phase !== "done" && !this.inFlight.has(i.invoiceId));
        if (!item) break;
        this.inFlight.add(item.invoiceId);
        try { await this.process(item.invoiceId); }
        catch (e) {
          console.error("[samlet-gjenlesing] steg", e);
          const it = this.get(item.invoiceId);
          if (it && it.phase !== "done") this.finalize(item.invoiceId, "feilet", it.phase === "applying" ? "ukjent_utfall_bruk" : "ukjent_utfall");
        } finally { this.inFlight.delete(item.invoiceId); }
      }
    } finally {
      this.workers--;
      if (this.workers === 0) this.settle();
      else this.emit();
    }
  }

  private settle() {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    if (this.ctx) localStorage.removeItem(leaseKey(this.ctx.le, this.ctx.uid));
    if (this.state?.status === "running" && this.state.items.every((i) => i.phase === "done")) {
      this.state = { ...this.state, status: "done" };
      this.save();
      this.summaryAudit();
    } else if (this.state?.status === "stopped") {
      this.summaryAudit();
      this.emit();
    } else this.emit();
    this.invalidate(true);
  }

  private invalidate(force = false) {
    if (!this.qc || (!force && Date.now() - this.lastInvalidate < 10_000)) return;
    this.lastInvalidate = Date.now();
    void this.qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura"] });
    void this.qc.invalidateQueries({ queryKey: ["samlet-gjenlesing"] });
    invalidateRavarerCounts(this.qc);
  }

  // ---- Ett steg per faktura ------------------------------------------------------------------------

  private finalize(id: string, outcome: Outcome, code: string | null, note: string | null = null) {
    const it = this.get(id);
    if (!it) return;
    this.update(id, { phase: "done", outcome, code, note });
    if (outcome !== "feilet") this.consecutive = 0;
    this.audit(it, outcome, code);
    if (outcome === "brukt") this.invalidate();
  }

  private transient(id: string, code: string) {
    this.consecutive++;
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + backoffMs(this.consecutive));
    const it = this.get(id);
    if (!it) return;
    if (it.attempts >= MAX_ATTEMPTS) this.finalize(id, "feilet", code);
    else this.update(id, { phase: "queued", runId: null, code });
    this.emit();
  }

  private failure(id: string, code: string) {
    const kind = classifyFailure(code);
    if (kind === "skip") return this.finalize(id, "hoppet_over", code);
    if (kind === "fail") return this.finalize(id, "feilet", code);
    if (kind === "pause_all") {
      const it = this.get(id);
      this.update(id, { phase: "queued", runId: null, attempts: Math.max(0, (it?.attempts ?? 1) - 1), code });
      this.pause(code === "ai_feil_nokkel" ? "AI-tjenesten avviste nøkkelen. Kjøringen er satt på pause; ingenting mer leses før nøkkelen virker."
        : "Du mangler tilgang til å lese fakturaene på nytt. Kjøringen er satt på pause.");
      return;
    }
    this.transient(id, code);
  }

  private async process(id: string) {
    for (let guard = 0; guard < 12; guard++) {
      const it = this.get(id);
      if (!it || it.phase === "done" || !this.ctx || !this.state) return;
      if (it.phase === "queued") {
        if (this.state.status !== "running") return;
        if (it.attempts >= MAX_ATTEMPTS) return this.finalize(id, "feilet", it.code ?? "ukjent_utfall");
        this.update(id, { phase: "begin_sent", attempts: it.attempts + 1, beginAt: new Date().toISOString(), runId: null });
        const b = await this.begin(it.invoiceId);
        if (b.kind === "ok") {
          this.update(id, { phase: "reading", runId: b.runId });
          this.invokes.set(id, await this.invokePreview(b.runId));
          continue;
        }
        if (b.kind === "rejected") { this.update(id, { phase: "queued" }); return this.failure(id, b.code); }
        const found = await this.findRun(id);
        if (found) { this.update(id, { phase: "reading", runId: found }); continue; }
        return this.transient(id, b.code);
      }
      if (it.phase === "begin_sent") {
        const found = await this.findRun(id);
        if (found) this.update(id, { phase: "reading", runId: found });
        else this.update(id, { phase: "queued", attempts: Math.max(0, it.attempts - 1) });
        continue;
      }
      if (it.phase === "reading" && it.runId) {
        const inv = this.invokes.get(id);
        this.invokes.delete(id);
        // Gatewayfeil (429/5xx) uten svar fra funksjonen: kjøringen ble aldri lest. Avbryt den og vent.
        if (inv?.returned && inv.code == null && inv.httpStatus != null && (inv.httpStatus === 429 || inv.httpStatus >= 500)) {
          const st = await this.fetchRun(it.runId);
          if (st && st !== "unavailable" && st.status === "reading") { await this.cancel(it.runId); return this.transient(id, inv.httpStatus === 429 ? "http_429" : "http_5xx"); }
        }
        const run = await this.pollRun(it.runId, inv?.returned && inv.code !== "ukjent_utfall" ? SHORT_WAIT_MS : LONG_WAIT_MS);
        if (run === "unavailable") { this.consecutive++; this.cooldownUntil = Date.now() + backoffMs(this.consecutive); continue; }
        if (!run) return this.finalize(id, "feilet", "finnes_ikke");
        if (run.status === "reading") { await this.cancel(run.id); return this.transient(id, "tidsavbrudd"); }
        if (run.status === "failed") return this.failure(id, run.error_code ?? "leser_feilet");
        if (run.status === "cancelled") return this.finalize(id, "feilet", "avbrutt");
        if (run.status === "applied") return this.finalize(id, "hoppet_over", "brukt_av_andre");
        this.consecutive = 0;
        const input = autoInputFromRun(run.snapshot, run.proposal);
        if (!input) return this.finalize(id, "forslag", "ugyldig_forslag");
        const d = decideAuto(input, { replace: await this.replaceAllowed() });
        if (d.kind === "uendret") { await this.cancel(run.id); return this.finalize(id, "uendret", null); }
        if (d.kind === "darligere") { await this.cancel(run.id); return this.finalize(id, "darligere", "darligere"); }
        if (d.kind === "forslag") return this.finalize(id, "forslag", d.reasons[0]?.code ?? null, d.reasons.map((r) => r.text).join(" "));
        this.update(id, { phase: "applying", ops: d.operations });
        continue;
      }
      if (it.phase === "applying" && it.runId && it.ops) {
        const res = await this.apply(it.runId, it.ops, autoApplyReason(this.state.dateLabel), it.invoiceId);
        if (res.kind === "applied") return this.finalize(id, "brukt", null);
        if (res.kind === "already_used") return this.finalize(id, "hoppet_over", "brukt_av_andre");
        if (res.kind === "rejected") return this.finalize(id, "forslag", codeFrom(res.message) ?? "forslag_avvist", "Ny lesing kunne ikke brukes automatisk. Se forslaget.");
        if (!this.applyRetried.has(id)) { this.applyRetried.add(id); this.consecutive++; this.cooldownUntil = Date.now() + backoffMs(this.consecutive); continue; }
        return this.finalize(id, "feilet", "ukjent_utfall_bruk");
      }
      return this.finalize(id, "feilet", "ukjent_utfall");
    }
    const it = this.get(id);
    if (it && it.phase !== "done") this.finalize(id, "feilet", it.phase === "applying" ? "ukjent_utfall_bruk" : "ukjent_utfall");
  }

  // ---- Kall -------------------------------------------------------------------------------------------

  private async begin(invoiceId: string): Promise<{ kind: "ok"; runId: string } | { kind: "rejected"; code: string } | { kind: "error"; code: string }> {
    try {
      const { data, error, status } = await supabase.rpc("rm_begin_invoice_reread", { p_invoice_id: invoiceId });
      if (error) {
        if (error.code === "42501") return { kind: "rejected", code: "forbidden" };
        if (error.code === "28000") return { kind: "rejected", code: "not_authenticated" };
        if (typeof error.message === "string" && error.message.includes("finnes_ikke")) return { kind: "rejected", code: "finnes_ikke" };
        return { kind: "error", code: status === 429 ? "http_429" : status >= 500 ? "http_5xx" : "nettverk" };
      }
      if (data && typeof data === "object" && !Array.isArray(data)) {
        if (data.ok === true && typeof data.run_id === "string") return { kind: "ok", runId: data.run_id };
        if (typeof data.code === "string") return { kind: "rejected", code: data.code };
      }
      return { kind: "error", code: "ukjent_utfall" };
    } catch (e) {
      console.error("[samlet-gjenlesing] start", e);
      return { kind: "error", code: "nettverk" };
    }
  }

  /** Ett kall til leseren. Svaret tolkes ikke som sannhet – kjøringen leses fra databasen etterpå. */
  private async invokePreview(runId: string): Promise<InvokeResult> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), PREVIEW_TIMEOUT_MS);
    try {
      const { data, error } = await supabase.functions.invoke("reread-invoice-preview", { body: { run_id: runId }, signal: ac.signal });
      const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : null;
      const ctx: unknown = error && typeof error === "object" && "context" in error ? (error as { context?: unknown }).context : null;
      const httpStatus = ctx instanceof Response ? ctx.status : null;
      let bodyCode = code;
      if (!bodyCode && ctx instanceof Response) {
        try { const j: unknown = await ctx.clone().json(); if (j && typeof j === "object" && "code" in j && typeof j.code === "string") bodyCode = j.code; } catch { /* ikke json */ }
      }
      return { returned: true, httpStatus: error ? httpStatus : 200, code: bodyCode };
    } catch (e) {
      console.error("[samlet-gjenlesing] leser", e);
      return { returned: false, httpStatus: null, code: null };
    } finally { clearTimeout(t); }
  }

  private async fetchRun(runId: string): Promise<RawRun | null | "unavailable"> {
    for (let i = 0; i < 3; i++) {
      const { data, error } = await supabase.from("invoice_reread_runs").select("id, status, error_code, snapshot, proposal").eq("id", runId).maybeSingle();
      if (!error) return data ?? null;
      await sleep(1_500);
    }
    return "unavailable";
  }

  private async pollRun(runId: string, waitMs: number): Promise<RawRun | null | "unavailable"> {
    const until = Date.now() + waitMs;
    for (;;) {
      const r = await this.fetchRun(runId);
      if (r === "unavailable" || !r || r.status !== "reading" || Date.now() > until) return r;
      await sleep(POLL_MS);
    }
  }

  /** En påbegynt lesing for denne fakturaen fra denne kjøringen (gjenfinnes etter omlasting/nettfeil). */
  private async findRun(id: string): Promise<string | null> {
    const it = this.get(id);
    if (!it || !this.ctx) return null;
    const since = new Date(Date.parse(it.beginAt ?? this.state?.startedAt ?? new Date().toISOString()) - 5 * 60_000).toISOString();
    const { data, error } = await supabase.from("invoice_reread_runs").select("id")
      .eq("invoice_id", it.invoiceId).eq("created_by", this.ctx.uid).in("status", ["reading", "ready"]).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(1);
    if (error) return null;
    return data?.[0]?.id ?? null;
  }

  private async cancel(runId: string) {
    try { const { error } = await supabase.rpc("rm_cancel_invoice_reread", { p_run_id: runId }); if (error) console.error("[samlet-gjenlesing] avbryt", error.code); }
    catch (e) { console.error("[samlet-gjenlesing] avbryt", e); }
  }

  private async apply(runId: string, ops: Operation[], reason: string, invoiceId: string) {
    const req = { runId, operations: ops, reason };
    const payload: Json = JSON.parse(JSON.stringify(ops));
    let call: { data: unknown; error: { code?: string | null; message?: string } | null } | { thrown: unknown };
    try {
      const { data, error } = await supabase.rpc("rm_apply_invoice_reread", { p_run_id: runId, p_operations: payload, p_reason: reason });
      call = { data, error };
    } catch (e) { call = { thrown: e }; }
    return decideApply(call, req, invoiceId, fetchRereadRun, { clear: () => undefined });
  }

  // ---- Revisjonslogg ---------------------------------------------------------------------------------

  private audit(it: RunItem, outcome: Outcome, code: string | null) {
    if (!this.ctx || !this.state) return;
    const row = {
      user_id: this.ctx.uid, legal_entity_id: this.ctx.le, action: "invoice.bulk_reread_outcome", entity_type: "invoice", entity_id: it.invoiceId,
      entity_display_reference: it.label.slice(0, 200), source_app: "ravarer", reason: `Samlet gjenlesing ${this.state.dateLabel}`,
      changes: { bulk_run_id: this.state.id, reread_run_id: it.runId, outcome, code, attempts: it.attempts },
    };
    void Promise.resolve(supabase.from("audit_log").insert(row)).then(({ error }) => { if (error) console.error("[samlet-gjenlesing] logg", error.code); }, (e: unknown) => console.error("[samlet-gjenlesing] logg", e));
  }

  private summaryAudit() {
    if (!this.ctx || !this.state) return;
    const c = runCounts(this.state);
    const row = {
      user_id: this.ctx.uid, legal_entity_id: this.ctx.le, action: "invoice.bulk_reread_summary", entity_type: "invoice_bulk_reread", entity_id: this.state.id,
      source_app: "ravarer", reason: `Samlet gjenlesing ${this.state.dateLabel}`,
      changes: { status: this.state.status, total: c.total, done: c.done, by_outcome: c.byOutcome, by_code: c.byCode, planned_skips: this.state.plannedSkips, started_at: this.state.startedAt },
    };
    void Promise.resolve(supabase.from("audit_log").insert(row)).then(({ error }) => { if (error) console.error("[samlet-gjenlesing] logg", error.code); }, (e: unknown) => console.error("[samlet-gjenlesing] logg", e));
  }
}

const KNOWN = ["snapshot_endret", "reread_utlopt", "reread_ikke_klar", "faktura_godkjent", "kostpris_fort", "faktura_last", "faktura_flagget", "tidligere_rettelse_beskyttet", "manuell_kobling_ma_avklares", "omberegning_kunne_ikke_koes", "forbidden"];
const codeFrom = (m: string) => KNOWN.find((k) => m.includes(k)) ?? null;

export const samletRunner = new SamletRunner();
