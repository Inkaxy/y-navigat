import { useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/fakturaer/lib/constants";
import { fmtNum } from "@/fakturaer/lib/units";
import { GENERIC_ERROR_MESSAGE } from "@/lib/userError";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { SupplierLinkRow } from "@/fakturaer/hooks/useSupplierLinkContext";
import { useLineMatchForm } from "@/fakturaer/hooks/useLineMatchForm";
import { recalculateLines } from "@/fakturaer/lib/acceptMatch";
import { acceptPriceVariance, canAcceptPriceVariance } from "@/fakturaer/lib/queueActions";
import type { LineStatus } from "@/fakturaer/lib/lineStatus";
import { costOf } from "@/fakturaer/lib/lineControl";
import { LineStatusBadge } from "@/fakturaer/components/inbox/LineStatusBadge";
import { MaterialPicker } from "@/fakturaer/components/inbox/task/MaterialPicker";
import { PackageForm } from "@/fakturaer/components/inbox/task/PackageForm";
import { PriceCheck } from "@/fakturaer/components/inbox/task/PriceCheck";
import { taskCopy, type TaskMode } from "@/fakturaer/components/inbox/task/taskCopy";

export type SecondaryAction = "create" | "not_rm" | "conflict" | "start_price";

export interface LineTaskProps {
  line: ReviewLineRow;
  status: LineStatus;
  link: SupplierLinkRow | null;
  tolerancePct: number;
  position: { index: number; total: number };
  canWrite: boolean;
  /** Kan endelig avstemming startes nå? (ingen linjer igjen som må avklares, og rett til det) */
  reconcileReady: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Kalles etter vellykket lagring. Kalleren henter serverens tilstand og avgjør neste linje. */
  onSaved: (lineId: string) => Promise<void>;
  onSecondary: (a: SecondaryAction, line: ReviewLineRow) => void;
  onShowDocument: (line: ReviewLineRow) => void;
  onReconcile: () => void;
}

/**
 * Valgt oppgave. Monteres med `key={line.id}`, så et utkast kan aldri følge med
 * til en annen linje. Lagring går gjennom samme skjema/kontrakt som MatchDrawer.
 */
export function LineTask(p: LineTaskProps) {
  const { line, status, link } = p;
  const form = useLineMatchForm(line);
  const [editMaterial, setEditMaterial] = useState(false);
  const [editPackage, setEditPackage] = useState(false);
  const [showScope, setShowScope] = useState(false);
  const [pkgOk, setPkgOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recalc, setRecalc] = useState<{ lineIds: string[] } | null>(null);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [agreedOpen, setAgreedOpen] = useState(false);

  const mode: TaskMode = editMaterial ? "material" : editPackage ? "package" : taskCopy.modeFor(status.key);
  const copy = taskCopy.forStatus(status.key);
  const currency = line.invoice.currency ?? "NOK";
  const supplier = line.invoice.supplier?.name ?? "leverandøren";
  const dataCost = costOf(line, link);
  const dataInconsistent = !!dataCost && !dataCost.checks.arithmeticPerInvoiceUnit && !dataCost.checks.arithmeticPerBaseUnit;
  const pkgValid = form.packageDraft.state === "valid" && !!form.cost && !form.cost.needsInput && !!form.selectedRm;
  const pkgHint =
    form.materialLoading
      ? "Henter råvaren …"
      : form.packageDraft.state === "invalid"
        ? form.packageDraft.reason
        : "Fyll inn innholdet slik at mengden kan regnes om.";

  async function save(confirmPackage: boolean, applyToAll = false) {
    setError(null);
    setNotice(null);
    setRecalc(null);
    try {
      const r = await form.save({ confirmPackage, applyToAll });
      if (r.stale) return;
      if (r.recalculationPending) {
        setRecalc({ lineIds: r.lineIds });
        return;
      }
      setNotice("Lagret. Henter oppdatert status …");
      setEditMaterial(false);
      setEditPackage(false);
      await p.onSaved(line.id);
      setNotice("Lagret.");
    } catch (e) {
      console.error("[fakturakontroll-lagre]", e);
      setError(`${GENERIC_ERROR_MESSAGE} Inntastingen er beholdt.`);
    }
  }

  const priceAcceptable = canAcceptPriceVariance(line);
  const [acceptBusy, setAcceptBusy] = useState(false);
  async function acceptPrice() {
    setError(null);
    setNotice(null);
    setAcceptBusy(true);
    try {
      await acceptPriceVariance(line);
      setNotice("Prisen er godtatt. Henter oppdatert status …");
      await p.onSaved(line.id);
      setNotice("Prisen er godtatt.");
    } catch (e) {
      console.error("[fakturakontroll-godta-pris]", e);
      setError(`${GENERIC_ERROR_MESSAGE} Linjen står åpen.`);
    } finally {
      setAcceptBusy(false);
    }
  }

  async function retryRecalc(ids: string[] | undefined = recalc?.lineIds) {
    if (!ids) return;
    setRecalcBusy(true);
    setError(null);
    try {
      await recalculateLines(line.invoice_id, ids);
      setRecalc(null);
      await p.onSaved(line.id);
    } catch (e) {
      console.error("[fakturakontroll-reberegn]", e);
      setRecalc({ lineIds: ids });
      setError("Prisen kunne ikke regnes om. Linjen står åpen.");
    } finally {
      setRecalcBusy(false);
    }
  }

  // --- Hovedhandling ------------------------------------------------------
  let primary: { label: string; run: (() => void) | null; hint: string };
  if (!p.canWrite && mode !== "done") {
    primary = { label: copy.primary, run: null, hint: "Du har ikke skrivetilgang til fakturakontroll." };
  } else if (mode === "material") {
    primary = {
      label: pkgOk ? "Bekreft råvare og pakning og fortsett" : "Bekreft råvare og fortsett",
      run: form.selectedRmId && form.selectedRm && form.packageDraft.state !== "invalid" ? () => void save(pkgOk && pkgValid) : null,
      hint: !form.selectedRmId
        ? "Velg en råvare først."
        : form.materialLoading
          ? "Henter råvaren …"
          : form.packageDraft.state === "invalid"
            ? form.packageDraft.reason
            : "Pakning og pris kontrolleres på nytt etter lagring.",
    };
  } else if (mode === "package") {
    primary = {
      label: "Bekreft pakning og fortsett",
      run: pkgValid && form.selectedRmId ? () => void save(true) : null,
      hint: pkgValid ? "Bekreftet pakning godkjenner ikke et eventuelt prisavvik." : pkgHint,
    };
  } else if (mode === "conflict") {
    primary = { label: "Løs konflikt", run: () => p.onSecondary("conflict", line), hint: copy.missing };
  } else if (status.key === "start_price") {
    primary = { label: "Bekreft startpris", run: () => p.onSecondary("start_price", line), hint: copy.missing };
  } else if (status.key === "recalculate") {
    primary = { label: "Beregn prisen på nytt", run: () => void retryRecalc([line.id]), hint: copy.missing };
  } else if (mode === "price" && p.canWrite && priceAcceptable) {
    primary = {
      label: "Prisen er riktig",
      run: () => void acceptPrice(),
      hint: "Godtar prisen på denne linjen. Avtaleprisen endres ikke.",
    };
  } else if (mode === "price" && p.canWrite) {
    primary = {
      label: "Kontroller pakningen",
      run: form.selectedRmId ? () => setEditPackage(true) : null,
      hint: "Prisen kan ikke sammenlignes ennå. Kontroller pakning, råvare eller avtalepris.",
    };
  } else if (mode === "done" && p.reconcileReady) {
    primary = { label: "Gå til bekreft prismatch", run: p.onReconcile, hint: "Alle linjer er avklart." };
  } else {
    primary = {
      label: "Gå til neste linje",
      run: p.position.index < p.position.total - 1 ? p.onNext : null,
      hint: mode === "price" ? "Prisavviket godkjennes ikke her — linjen står åpen til det er avklart." : copy.missing,
    };
  }

  const rmName = form.selectedRm?.name ?? line.matched_raw_material?.name ?? null;
  const baseUnit = form.selectedRm?.base_unit ?? line.matched_raw_material?.base_unit ?? null;

  return (
    <article className="flex flex-col rounded-xl border border-line-subtle bg-card" aria-label="Valgt fakturalinje">
      <header className="space-y-1 border-b border-line-subtle px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-ink-secondary">
            Linje {p.position.index + 1} av {p.position.total}
          </span>
          <div className="flex items-center gap-1">
            <LineStatusBadge status={status} />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={p.onPrev} disabled={p.position.index <= 0} aria-label="Forrige linje">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={p.onNext} disabled={p.position.index >= p.position.total - 1} aria-label="Neste linje">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <h2 className="font-serif text-lg leading-snug">{line.description ?? "Uten varetekst"}</h2>
        <p className="text-caption text-ink-secondary">
          Fakturert: {line.quantity == null ? "—" : fmtNum(Number(line.quantity))} {line.unit ?? ""} · {formatMoney(line.unit_price, currency)} per {line.unit ?? "enhet"} ·{" "}
          {formatMoney(line.total_amount, currency)} eks. mva
        </p>
        {dataInconsistent && (
          <p className="rounded-md bg-warning/10 px-2 py-1 text-caption text-warning">
            Mengde, pris og linjesum på fakturaen går ikke opp med hverandre. Regnestykket under er en foreløpig tolkning — kontroller mot originalfakturaen.
          </p>
        )}
        {mode !== "done" && <p className="pt-1 text-sm">{copy.missing}</p>}
      </header>

      <div className="space-y-4 px-4 py-3">
        {mode !== "material" && rmName && (
          <SummaryRow label="Råvare" value={`${rmName}${baseUnit ? ` · per ${baseUnit}` : ""}`} action={p.canWrite ? { label: "Endre", run: () => setEditMaterial(true) } : null} />
        )}
        {mode === "material" && <MaterialPicker form={form} lineId={line.id} />}
        {(mode === "package" || (mode === "material" && form.selectedRmId)) && <PackageForm line={line} form={form} />}
        {mode === "material" && form.selectedRmId && pkgValid && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={pkgOk} onCheckedChange={(v) => setPkgOk(!!v)} />
            <span>Pakningen stemmer — bekreft den for {supplier}</span>
          </label>
        )}
        {(mode === "price" || mode === "done") && <PriceCheck line={line} link={link} tolerancePct={p.tolerancePct} />}
        {mode === "price" && p.canWrite && !agreedOpen && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditMaterial(true)}>
              Endre råvare
            </Button>
            <Button size="sm" variant="outline" disabled={!form.selectedRmId} onClick={() => setAgreedOpen(true)}>
              Rett avtalepris
            </Button>
          </div>
        )}
        {agreedOpen && (
          <div className="space-y-1">
            <label htmlFor={`agreed-${line.id}`} className="text-caption">Avtalepris per {baseUnit ?? "grunnenhet"} hos {supplier}</label>
            <input
              id={`agreed-${line.id}`}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              inputMode="decimal"
              value={form.agreedPrice}
              onChange={(e) => form.setAgreedPrice(e.target.value)}
            />
            <p className="text-caption text-ink-secondary">
              Lagres som avtalepris for {rmName ?? "råvaren"} hos {supplier} og gjelder også senere fakturaer. Linjen regnes om mot den — avviket godkjennes ikke automatisk.
            </p>
            <Button size="sm" variant="outline" disabled={form.busy || !form.selectedRmId} onClick={() => void save(false)}>
              Lagre avtalepris og beregn på nytt
            </Button>
          </div>
        )}

        {(mode === "material" || mode === "package") && form.selectedRmId && (
          <div className="rounded-md bg-muted/40 px-3 py-2 text-caption">
            <span className="font-medium">Dette lagres: </span>
            kobling til {rmName ?? "valgt råvare"}
            {mode === "package" || pkgOk ? `, pakningen som bekreftet for ${supplier} (brukes på senere fakturaer)` : ", pakningen som forslag"}
            {form.rememberSku || form.rememberName ? `, og ${supplier}s ${[form.rememberSku && "varenummer", form.rememberName && "varetekst"].filter(Boolean).join(" og ")} huskes for denne råvaren` : ""}.{" "}
            <button type="button" className="underline underline-offset-2" aria-expanded={showScope} onClick={() => setShowScope((v) => !v)}>
              Endre
            </button>
            {showScope && (
              <div className="mt-2 space-y-1.5">
                <label className="flex items-center gap-2">
                  <Checkbox checked={form.rememberSku} disabled={!line.supplier_sku} onCheckedChange={(v) => form.setRememberSku(!!v)} />
                  Husk varenummeret {line.supplier_sku ?? ""}
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={form.rememberName} disabled={!line.description} onCheckedChange={(v) => form.setRememberName(!!v)} />
                  Husk leverandørens varetekst
                </label>
              </div>
            )}
          </div>
        )}

        {recalc && (
          <div role="alert" className="space-y-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            Koblingen er lagret, men prisen er ikke regnet om. Linjen står åpen.
            <Button size="sm" variant="outline" disabled={recalcBusy} onClick={() => void retryRecalc()}>
              {recalcBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Prøv igjen
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && !error && <p className="text-caption text-success" aria-live="polite">{notice}</p>}
      </div>

      <footer className="sticky bottom-0 z-10 flex flex-col gap-2 rounded-b-xl border-t border-line-subtle bg-card px-4 py-3">
        <p className="text-caption text-ink-secondary" id={`hint-${line.id}`}>{primary.hint}</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" className="mr-auto gap-1.5" disabled={!line.invoice.source_document_url} onClick={() => p.onShowDocument(line)}>
            <FileText className="h-4 w-4" /> Originalfaktura
          </Button>
          {p.canWrite && mode !== "done" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Flere valg for linjen">
                  <MoreHorizontal className="h-4 w-4" /> Mer
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditMaterial(true)}>Endre råvare</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => p.onSecondary("create", line)}>Ny råvare …</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => p.onSecondary("not_rm", line)}>Ikke råvare … (oppgi grunn)</DropdownMenuItem>
                <DropdownMenuItem disabled={form.aiBusy} onSelect={() => { setEditMaterial(true); void form.runAiSuggestion(); }}>Hent AI-forslag</DropdownMenuItem>
                <DropdownMenuItem disabled={!form.selectedRmId} onSelect={() => setAgreedOpen(true)}>Registrer avtalepris</DropdownMenuItem>
                <DropdownMenuItem disabled={!form.selectedRmId || form.busy} onSelect={() => void save(mode === "package", true)}>
                  Lagre og bruk på like linjer på fakturaen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {mode !== "done" && primary.label !== "Gå til neste linje" && (
            <Button variant="outline" size="sm" onClick={p.onNext} disabled={p.position.index >= p.position.total - 1}>
              Hopp over
            </Button>
          )}
          <Button size="sm" disabled={!primary.run || form.busy} aria-describedby={`hint-${line.id}`} onClick={() => primary.run?.()}>
            {form.busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {primary.label}
          </Button>
        </div>
        {(form.aiNotice || form.aiSuggestion) && (
          <p className="text-caption text-ink-secondary">{form.aiNotice ?? "AI-forslaget er fylt inn, men ikke bekreftet."}</p>
        )}
      </footer>
    </article>
  );
}

function SummaryRow({ label, value, action }: { label: string; value: string; action: { label: string; run: () => void } | null }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-1.5 text-sm">
      <span className="min-w-0 truncate">
        <span className="text-ink-secondary">{label}: </span>
        {value}
      </span>
      {action && (
        <button type="button" className="shrink-0 text-caption text-primary underline underline-offset-2" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}
