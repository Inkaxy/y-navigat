import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RotateCw, Search } from "lucide-react";
import { QueryState } from "@/components/common/QueryState";
import { InboxRow } from "@/fakturaer/components/inbox/InboxRow";
import {
  COMPLETED_PAGE_SIZE,
  matchesInboxSearch,
  useCompletedInvoices,
  type InboxInvoice,
} from "@/fakturaer/hooks/useInboxInvoices";
import type { InboxPrimaryAction, InboxTab } from "@/fakturaer/lib/inbox";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";

export const OPEN_PAGE_SIZE = 25;

export interface BatchFailure {
  id: string;
  label: string;
}

interface Props {
  tab: InboxTab;
  onTabChange: (t: InboxTab) => void;
  invoices: InboxInvoice[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  legalEntityId: string | null;
  supplierId: string | null;
  supplierFilter: ReactNode;
  canWrite: boolean;
  canReconcile: boolean;
  busyId: string | null;
  onPrimary: (inv: InboxInvoice, action: InboxPrimaryAction) => void;
  onRematch: (inv: InboxInvoice) => void;
  onOpenDetail: (inv: InboxInvoice) => void;
  onFlag: (inv: InboxInvoice) => void;
  onUnflag: (inv: InboxInvoice) => void;
  /** Kjører matching for de oppgitte fakturaene og returnerer de som feilet. */
  onBatchMatch: (targets: InboxInvoice[], onProgress: (done: number) => void) => Promise<BatchFailure[]>;
}

/** Arbeidsinnboksen: tre faner, søk, leverandørfilter og ekte totaltall. */
export function InvoiceInbox(p: Props) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);
  const [visible, setVisible] = useState(OPEN_PAGE_SIZE);
  const [donePage, setDonePage] = useState(0);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<BatchFailure[]>([]);

  const filtered = useMemo(() => p.invoices.filter((i) => matchesInboxSearch(i, search)), [p.invoices, search]);
  const openRows = useMemo(() => filtered.filter((i) => i.tab === "open"), [filtered]);
  const readyRows = useMemo(() => filtered.filter((i) => i.tab === "ready"), [filtered]);

  const completed = useCompletedInvoices({
    legalEntityId: p.legalEntityId,
    supplierId: p.supplierId,
    search: debounced,
    page: donePage,
    enabled: p.tab === "done",
  });

  // Nytt filter eller søk starter på første side; en side utenfor totalen klemmes.
  useEffect(() => setDonePage(0), [p.supplierId, p.legalEntityId, debounced]);

  const rows = p.tab === "open" ? openRows : p.tab === "ready" ? readyRows : (completed.data?.rows ?? []);
  const shown = p.tab === "done" ? rows : rows.slice(0, visible);
  const doneTotal = completed.data?.total ?? null;
  const doneLastPage = doneTotal == null ? 0 : Math.max(0, Math.ceil(doneTotal / COMPLETED_PAGE_SIZE) - 1);
  useEffect(() => {
    if (doneTotal != null && donePage > doneLastPage) setDonePage(doneLastPage);
  }, [doneTotal, donePage, doneLastPage]);

  async function runBatch(targets: InboxInvoice[]) {
    if (targets.length === 0) return;
    setFailures([]);
    setBatch({ done: 0, total: targets.length });
    const failed = await p.onBatchMatch(targets, (done) => setBatch({ done, total: targets.length }));
    setBatch(null);
    setFailures(failed);
  }

  const matchTargets = p.invoices.filter((i) => i.tab !== "done" && i.status !== "flagged" && i.line_count > 0);
  const isDone = p.tab === "done";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={p.tab}
          onValueChange={(v) => {
            p.onTabChange(v as InboxTab);
            setVisible(OPEN_PAGE_SIZE);
          }}
        >
          <TabsList>
            <TabsTrigger value="open">Må avklares {!p.isLoading && <span className="ml-1.5 tabular-nums text-ink-secondary">{openRows.length}</span>}</TabsTrigger>
            <TabsTrigger value="ready">Klar til å fullføre {!p.isLoading && <span className="ml-1.5 tabular-nums text-ink-secondary">{readyRows.length}</span>}</TabsTrigger>
            <TabsTrigger value="done">Fullført {doneTotal != null && <span className="ml-1.5 tabular-nums text-ink-secondary">{doneTotal}</span>}</TabsTrigger>
          </TabsList>
        </Tabs>
        {p.canWrite && !isDone && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto gap-1.5"
            disabled={!!batch || matchTargets.length === 0}
            onClick={() => void runBatch(matchTargets)}
          >
            {batch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            {batch ? `Oppdaterer ${batch.done} av ${batch.total}` : "Oppdater matching"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-secondary" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisible(OPEN_PAGE_SIZE);
              setDonePage(0);
            }}
            placeholder="Søk leverandør eller fakturanummer"
            aria-label="Søk leverandør eller fakturanummer"
            className="pl-8"
          />
        </div>
        {p.supplierFilter}
      </div>

      {failures.length > 0 && (
        <Card role="alert" className="flex flex-wrap items-center gap-2 border-destructive/40 p-3 text-sm">
          <span>
            Matching feilet for {failures.length} {failures.length === 1 ? "faktura" : "fakturaer"}:{" "}
            {failures.slice(0, 4).map((f) => f.label).join(", ")}
            {failures.length > 4 ? " m.fl." : ""}. Ingenting er godkjent.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => void runBatch(p.invoices.filter((i) => failures.some((f) => f.id === i.id)))}
          >
            Prøv igjen
          </Button>
        </Card>
      )}

      <QueryState
        scope="fakturaer:innboks"
        isLoading={isDone ? completed.isLoading : p.isLoading}
        isError={isDone ? completed.isError : p.isError}
        error={isDone ? completed.error : p.error}
        isEmpty={rows.length === 0}
        emptyTitle={
          search
            ? "Ingen fakturaer passer søket"
            : p.tab === "open"
              ? "Ingen fakturaer må avklares"
              : p.tab === "ready"
                ? "Ingen fakturaer er klare til å fullføres"
                : "Ingen fullførte fakturaer"
        }
        onRetry={isDone ? () => void completed.refetch() : p.onRetry}
      >
        <Card className="overflow-hidden p-0">
          <ul>
            {shown.map((inv) => (
              <InboxRow
                key={inv.id}
                invoice={inv}
                canWrite={p.canWrite}
                canReconcile={p.canReconcile}
                busy={p.busyId === inv.id}
                onPrimary={(a) => p.onPrimary(inv, a)}
                onRematch={() => p.onRematch(inv)}
                onOpenDetail={() => p.onOpenDetail(inv)}
                onFlag={() => p.onFlag(inv)}
                onUnflag={() => p.onUnflag(inv)}
              />
            ))}
          </ul>
        </Card>
        <div className="flex items-center justify-between gap-2 text-caption text-ink-secondary">
          {isDone ? (
            <>
              <span>
                Side {donePage + 1} av {doneLastPage + 1} · {doneTotal ?? 0} fullførte
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant="outline" disabled={donePage === 0} onClick={() => setDonePage((x) => x - 1)}>
                  Forrige
                </Button>
                <Button size="sm" variant="outline" disabled={donePage >= doneLastPage} onClick={() => setDonePage((x) => x + 1)}>
                  Neste
                </Button>
              </span>
            </>
          ) : (
            <>
              <span>
                Viser {shown.length} av {rows.length}
              </span>
              {shown.length < rows.length && (
                <Button size="sm" variant="outline" onClick={() => setVisible((v) => v + OPEN_PAGE_SIZE)}>
                  Vis flere
                </Button>
              )}
            </>
          )}
        </div>
      </QueryState>
    </div>
  );
}
