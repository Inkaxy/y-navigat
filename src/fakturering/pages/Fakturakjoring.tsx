import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { addDays, format, isToday } from "date-fns";
import { nb } from "date-fns/locale";
import {
  ArrowLeft, ArrowRight, ChevronRight, Receipt, AlertTriangle, CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useFaktureringEntity } from "@/fakturering/context/FaktureringContext";
import {
  useInvoiceRunPreview,
  useInvoiceSettings,
  useTripletexTokenStatus,
  useHasFakturaWriteAccess,
  useRecentInvoiceRuns,
  type PreviewRow,
} from "@/fakturering/hooks/useFakturering";
import { KNOWN_GROUPS, isKnownGroup, groupDefFor, formatKr } from "@/fakturering/lib/groups";
import { GroupCard } from "@/fakturering/components/GroupCard";
import { ConfirmRunDialog } from "@/fakturering/components/ConfirmRunDialog";
import { PreviewDrawer } from "@/fakturering/components/PreviewDrawer";
import { EntityPickerBanner } from "@/fakturering/components/EntityPickerBanner";
import { cn } from "@/lib/utils";
import { readEdgeError } from "@/fakturering/lib/edgeError";

function toISO(d: Date) { return format(d, "yyyy-MM-dd"); }

export default function Fakturakjoring() {
  const { activeEntityId, activeEntity } = useFaktureringEntity();
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [runDate, setRunDate] = useState<Date>(new Date());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const runDateISO = toISO(runDate);
  const preview = useInvoiceRunPreview(activeEntityId, runDateISO);
  const settings = useInvoiceSettings(activeEntityId);
  const tripletex = useTripletexTokenStatus(activeEntityId);
  const writeAccess = useHasFakturaWriteAccess();
  const recentRuns = useRecentInvoiceRuns(activeEntityId, 5);

  const previewRows = preview.data ?? [];
  const rowByKey = useMemo(() => {
    const m = new Map<string, PreviewRow>();
    for (const r of previewRows) m.set(r.invoicing_group ?? "__none", r);
    return m;
  }, [previewRows]);

  const orphanRow = rowByKey.get("__none");

  const internalGroups = settings.data?.internal_groups ?? [];
  const nonTransferGroups = settings.data?.non_transfer_groups ?? [];

  const toggleGroup = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Kjente + ukjente grupper (ukjente kommer fra preview-radene og skal
  // fortsatt kunne fakturers — de ble tidligere skjult stille).
  const unknownGroupKeys = useMemo(
    () => previewRows
      .map((r) => r.invoicing_group)
      .filter((g): g is string => !!g && !isKnownGroup(g)),
    [previewRows],
  );

  const selectedRows: PreviewRow[] = useMemo(() => {
    const rows: PreviewRow[] = [];
    for (const g of KNOWN_GROUPS) {
      if (!selected.has(g.key)) continue;
      const r = rowByKey.get(g.key);
      if (r && r.customer_count > 0) rows.push(r);
    }
    for (const k of unknownGroupKeys) {
      if (!selected.has(k)) continue;
      const r = rowByKey.get(k);
      if (r && r.customer_count > 0) rows.push(r);
    }
    return rows;
  }, [selected, rowByKey, unknownGroupKeys]);

  const totalBasis = selectedRows.reduce((s, r) => s + r.customer_count, 0);
  const totalSum = selectedRows.reduce((s, r) => s + r.sum_incl_vat, 0);

  const canRun =
    writeAccess.data === true &&
    tripletex.data?.connected === true &&
    selectedRows.length > 0 &&
    !isRunning;

  const runDisabledReason = !writeAccess.data
    ? "Krever skrivetilgang til Fakturering"
    : !tripletex.data?.connected
      ? "Tripletex er ikke tilkoblet"
      : selectedRows.length === 0
        ? "Velg minst én gruppe"
        : "";

  async function handleRun() {
    if (!activeEntityId) return;
    setIsRunning(true);
    try {
      const groups = selectedRows.map((r) => r.invoicing_group).filter((g): g is string => !!g);
      const { data: runResult, error: runErr } = await (supabase.rpc as any)("create_invoice_run", {
        p_legal_entity_id: activeEntityId,
        p_run_date: runDateISO,
        p_groups: groups,
      });
      if (runErr) throw runErr;
      const runId = runResult?.run_id;
      if (!runId) throw new Error("Ingen kjørings-ID returnert");

      toast({ title: "Grunnlag opprettet", description: `${runResult.basis_count} grunnlag klare for overføring.` });

      // Ikke-blokkerende overføring: naviger til kjørings-siden umiddelbart —
      // running-pollingen der viser status live og fanger opp feil.
      supabase.functions
        .invoke("fakturering-transfer-run", { body: { run_id: runId } })
        .then(({ error }) => {
          if (error) {
            readEdgeError(error).then((msg) =>
              toast({ title: "Overføring feilet", description: msg, variant: "destructive" }),
            );
          }
          qc.invalidateQueries({ queryKey: ["fakturering"] });
        })
        .catch(async (e) => {
          toast({ title: "Overføring feilet", description: await readEdgeError(e), variant: "destructive" });
        });

      // Fire-and-forget attachment generation — feil stopper aldri kjøringen.
      supabase.functions.invoke("fakturering-generate-vedlegg", { body: { run_id: runId } })
        .catch((e) => console.warn("vedlegg-gen failed", e));

      toast({ title: "Overføring startet", description: "Følg med på fremdriften — vedlegg lastes opp underveis." });

      qc.invalidateQueries({ queryKey: ["fakturering"] });
      setConfirmOpen(false);
      navigate(`/fakturering/kjoringer/${runId}`);
    } catch (e: any) {
      toast({
        title: "Kunne ikke kjøre fakturering",
        description: await readEdgeError(e),
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fakturering"
        title="Fakturakjøring"
        subtitle="Grunnlag fra leverte ordrer → overføres som ordre-utkast til Tripletex"
        icon={Receipt}
        actions={<TripletexChip status={tripletex.data} entityName={activeEntity?.legal_name ?? null} isLoading={tripletex.isLoading} />}
      />

      <EntityPickerBanner />

      {pendingReturns > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{pendingReturns} returer venter på godkjenning.</strong> De kommer ikke med i
            denne kjøringen før de er godkjent.
          </span>
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link to="/ordre/returer">Gå til returer</Link>
          </Button>
        </div>
      )}





      {/* Datovelger */}
      <div className="flex flex-col items-center gap-2 py-4">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setRunDate((d) => addDays(d, -1))}
            aria-label="Forrige dag"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-center rounded-md px-3 py-1 -mx-1 hover:bg-muted/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Velg dato"
              >
                <div className="font-display text-3xl font-semibold tabular-nums">
                  {format(runDate, "dd.MM.yyyy")}
                </div>
                <div className={cn(
                  "text-sm font-medium capitalize",
                  isToday(runDate) ? "text-[hsl(var(--brand-bronze))]" : "text-muted-foreground",
                )}>
                  {isToday(runDate) ? "i dag, " : ""}{format(runDate, "EEEE", { locale: nb })}
                </div>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="center">
              <Calendar
                mode="single"
                selected={runDate}
                onSelect={(d) => d && setRunDate(d)}
                initialFocus
                locale={nb}
                weekStartsOn={1}
                showWeekNumber
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setRunDate((d) => addDays(d, 1))}
            aria-label="Neste dag"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Tar med alle leverte, ufakturerte ordrer med leveringsdato{" "}
          <strong className="text-text-primary">til og med {format(runDate, "dd.MM.yyyy")}</strong>
        </p>
      </div>

      {/* Orphan-varsel */}
      {orphanRow && orphanRow.customer_count > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-[hsl(var(--brand-bronze)/0.4)] bg-[hsl(var(--brand-bronze)/0.08)] px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-[hsl(var(--brand-bronze))]" />
          <div className="flex-1">
            <div className="font-medium text-text-primary">
              {orphanRow.customer_count} kunder mangler faktureringsgruppe ({orphanRow.order_count} ordrer, {formatKr(orphanRow.sum_incl_vat)})
            </div>
            <div className="text-muted-foreground">
              Disse blir ikke fakturert. <Link to="/kunder" className="underline underline-offset-2">Åpne kundelisten →</Link>
            </div>
          </div>
        </div>
      )}

      {/* Feiltilstand for forhåndsvisning */}
      {preview.isError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <div className="font-medium text-destructive">Kunne ikke hente grunnlaget</div>
          <div className="mt-1 text-muted-foreground">
            {(preview.error as Error)?.message ?? "Ukjent feil"}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => preview.refetch()}
            disabled={preview.isFetching}
          >
            Prøv igjen
          </Button>
        </div>
      )}

      {/* Gruppekort */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">

        {KNOWN_GROUPS.map((def) => {
          const row = rowByKey.get(def.key);
          const cc = row?.customer_count ?? 0;
          const oc = row?.order_count ?? 0;
          const sum = row?.sum_incl_vat ?? 0;
          return (
            <GroupCard
              key={def.key}
              def={def}
              customerCount={cc}
              orderCount={oc}
              sumInclVat={sum}
              isEmpty={cc === 0}
              isInternal={internalGroups.includes(def.key)}
              isNonTransfer={nonTransferGroups.includes(def.key)}
              selected={selected.has(def.key)}
              onToggle={() => toggleGroup(def.key)}
            />
          );
        })}
        {unknownGroupKeys.map((key) => {
          const row = rowByKey.get(key)!;
          const def = groupDefFor(key);
          return (
            <GroupCard
              key={`unknown-${key}`}
              def={def}
              customerCount={row.customer_count}
              orderCount={row.order_count}
              sumInclVat={row.sum_incl_vat}
              isEmpty={row.customer_count === 0}
              isInternal={false}
              isNonTransfer={false}
              selected={selected.has(key)}
              onToggle={() => toggleGroup(key)}
            />
          );
        })}
      </div>



      {/* Handlingslinje */}
      <div className="flex flex-col gap-4 rounded-2xl border border-line-subtle bg-surface-raised p-5 lg:flex-row lg:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <Button
            size="lg"
            disabled={!canRun}
            onClick={() => setConfirmOpen(true)}
            className="bg-[hsl(var(--app-primary))] text-white hover:bg-[hsl(var(--app-primary)/0.9)]"
          >
            <Receipt className="mr-2 h-4 w-4" />
            Kjør fakturering — {selectedRows.length} {selectedRows.length === 1 ? "gruppe" : "grupper"} · {totalBasis} grunnlag · {formatKr(totalSum)}
          </Button>
          <Button
            variant="outline"
            size="lg"
            disabled={selectedRows.length === 0}
            onClick={() => setPreviewOpen(true)}
          >
            Forhåndsvis grunnlag
          </Button>
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          {runDisabledReason ? (
            <span className="text-[hsl(var(--brand-bronze))]">{runDisabledReason}. </span>
          ) : null}
          Oppretter fakturagrunnlag per kunde og overfører dem som <strong>ordre-utkast</strong> til Tripletex.
          Ingen faktura sendes fra NBHub — godkjenning og utsendelse skjer i Tripletex.
        </p>
      </div>

      {/* Siste kjøringer */}
      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Siste kjøringer
        </h2>
        <div className="overflow-hidden rounded-xl border border-line-subtle bg-surface-raised">
          {recentRuns.isLoading && (
            <div className="p-4 text-sm text-muted-foreground">Laster…</div>
          )}
          {!recentRuns.isLoading && (recentRuns.data ?? []).length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">Ingen tidligere kjøringer.</div>
          )}
          {(recentRuns.data ?? []).map((run, idx) => {
            const groupsLabel = (run.groups ?? [])
              .map((g) => groupDefFor(g).label)
              .join(" + ") || "—";
            const ts = run.started_at ? format(new Date(run.started_at), "dd.MM.yyyy HH:mm") : "—";
            const runNo = run.run_no ?? (recentRuns.data!.length - idx);
            return (
              <Link
                key={run.id}
                to={`/fakturering/kjoringer/${run.id}`}
                className="flex flex-wrap items-center gap-3 border-b border-line-subtle px-4 py-3 last:border-b-0 hover:bg-surface-sunken"
              >
                <span className="font-mono text-sm font-semibold text-muted-foreground">#{runNo}</span>
                <span className="text-sm text-text-primary">·</span>
                <span className="text-sm tabular-nums text-text-primary">{ts}</span>
                <span className="text-sm text-muted-foreground">·</span>
                <span className="text-sm text-text-primary">{groupsLabel}</span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {run.transferred_count > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      {run.transferred_count} overført
                    </span>
                  )}
                  {run.failed_count > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">
                      <XCircle className="h-3 w-3" />
                      {run.failed_count} feilet
                    </span>
                  )}
                  {run.status === "running" && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Kjører
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--app-primary))]">
                    Åpne <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <ConfirmRunDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        selected={selectedRows}
        onConfirm={handleRun}
        isRunning={isRunning}
      />
      <PreviewDrawer
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        entityId={activeEntityId}
        runDate={runDateISO}
        selectedGroups={Array.from(selected)}
        previewRows={previewRows}
      />
    </div>
  );
}

function TripletexChip({
  status, entityName, isLoading,
}: {
  status: { connected: boolean } | undefined;
  entityName: string | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <span className="inline-flex items-center gap-2 rounded-full border border-line-subtle bg-surface-sunken px-3 py-1.5 text-sm text-muted-foreground">Sjekker Tripletex…</span>;
  }
  if (status?.connected) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-800 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" />
        Tripletex tilkoblet{entityName ? ` · ${entityName}` : ""}
      </span>
    );
  }
  return (
    <Link
      to="/fakturering/innstillinger"
      className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-500/20 dark:text-red-300"
    >
      <XCircle className="h-4 w-4" />
      Tripletex ikke tilkoblet — sett opp i Innstillinger
    </Link>
  );
}
