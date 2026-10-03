import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/common/QueryState";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { SupplierLinkContext } from "@/fakturaer/hooks/useSupplierLinkContext";
import { BUCKET_LABELS, type LineBucket, type LineStatus } from "@/fakturaer/lib/lineStatus";
import { GROUP_LABELS, REVIEW_GROUPS, type QueueSort, type ReviewGroup } from "@/fakturaer/lib/reviewReasons";
import { LineList } from "@/fakturaer/components/inbox/LineList";
import { LineControlPanel, type LineDialogAction } from "@/fakturaer/components/inbox/LineControlPanel";

export type BucketTab = LineBucket | "all";
const BUCKETS: BucketTab[] = ["all", "needs", "ready", "done"];

const SORT_OPTIONS: { value: QueueSort; label: string }[] = [
  { value: "invoice_date", label: "Nyeste faktura først" },
  { value: "impact", label: "Størst kronepåvirkning først" },
  { value: "repeats", label: "Går oftest igjen først" },
];

interface Props {
  lines: ReviewLineRow[];
  statusOf: (l: ReviewLineRow) => LineStatus;
  counts: Record<BucketTab, number>;
  bucket: BucketTab;
  onBucket: (b: BucketTab) => void;
  reason: ReviewGroup | "all";
  onReason: (r: ReviewGroup | "all") => void;
  sort: QueueSort;
  onSort: (s: QueueSort) => void;
  /** Satt når én faktura er åpen og alle linjene er hentet. */
  progress: { handled: number; total: number; needs: number } | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  emptyTitle: string;
  activeLine: ReviewLineRow | null;
  onSelect: (l: ReviewLineRow) => void;
  onPrev: () => void;
  onNext: () => void;
  selected: Record<string, boolean>;
  onToggleSelect: (id: string, v: boolean) => void;
  bulk: { count: number; acceptable: number; busy: boolean; onAccept: () => void; onNotApplicable: () => void; onCreate: () => void; onClear: () => void };
  readyToAccept: { count: number; onAccept: () => void };
  links: SupplierLinkContext;
  toleranceFor: (legalEntityId: string | null, category?: string | null) => number;
  showInvoice: boolean;
  canWrite: boolean;
  busy: boolean;
  isMobile: boolean;
  countsError: boolean;
  onAction: (a: LineDialogAction, l: ReviewLineRow) => void;
  onAccept: (l: ReviewLineRow) => void;
  onShowDocument: (l: ReviewLineRow) => void;
}

/** Én sammenhengende arbeidsflate: kompakt linjeoversikt + kontroll av valgt linje. */
export function QueueWorkspace(p: Props) {
  const index = p.activeLine ? p.lines.findIndex((l) => l.id === p.activeLine?.id) : -1;
  const panel = p.activeLine ? (
    <LineControlPanel
      line={p.activeLine}
      status={p.statusOf(p.activeLine)}
      link={p.links.forLine(p.activeLine)}
      tolerancePct={p.toleranceFor(
        p.activeLine.invoice.legal_entity_id,
        p.activeLine.matched_raw_material?.category ?? p.activeLine.suggestions?.[0]?.raw_material?.category ?? null,
      )}
      position={{ index: Math.max(index, 0), total: p.lines.length }}
      canWrite={p.canWrite}
      busy={p.busy}
      onAction={p.onAction}
      onAccept={p.onAccept}
      onPrev={p.onPrev}
      onNext={p.onNext}
      onShowDocument={p.onShowDocument}
    />
  ) : null;

  return (
    <div className="space-y-3">
      {p.progress && (
        <div className="space-y-1.5" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <strong>{p.progress.handled}</strong> av {p.progress.total} linjer avklart
              {p.progress.needs > 0 ? ` · ${p.progress.needs} må avklares før prismatch kan bekreftes` : " · klar for «Bekreft prismatch»"}
            </span>
          </div>
          <Progress value={p.progress.total ? (p.progress.handled / p.progress.total) * 100 : 0} aria-label="Fremdrift for fakturaen" />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={p.bucket} onValueChange={(v) => p.onBucket(v as BucketTab)}>
          <TabsList className="flex-wrap">
            {BUCKETS.map((b) => (
              <TabsTrigger key={b} value={b}>
                {BUCKET_LABELS[b]} ({p.counts[b] ?? 0})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={p.reason} onValueChange={(v) => p.onReason(v as ReviewGroup | "all")}>
            <SelectTrigger className="h-9 w-[200px]" aria-label="Filtrer på årsak">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle årsaker</SelectItem>
              {REVIEW_GROUPS.map((g) => (
                <SelectItem key={g} value={g}>
                  {GROUP_LABELS[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={p.sort} onValueChange={(v) => p.onSort(v as QueueSort)}>
            <SelectTrigger className="h-9 w-[220px]" aria-label="Sorter linjene">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {p.readyToAccept.count > 0 && (
            <Button size="sm" disabled={!p.canWrite || p.bulk.busy} onClick={p.readyToAccept.onAccept}>
              Godta {p.readyToAccept.count} {p.readyToAccept.count === 1 ? "forslag" : "forslag"} uten andre avvik
            </Button>
          )}
        </div>
      </div>

      {p.countsError && (
        <p className="text-caption text-destructive">Tellerne kunne ikke hentes — tallene i fanene kan være ufullstendige.</p>
      )}

      {p.bulk.count > 0 && !p.isMobile && (
        <Card className="flex flex-wrap items-center gap-2 border-primary/30 bg-primary/5 p-3">
          <span className="text-sm font-medium">{p.bulk.count} valgt</span>
          <Button size="sm" disabled={!p.canWrite || p.bulk.busy || p.bulk.acceptable === 0} onClick={p.bulk.onAccept}>
            {p.bulk.busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Godta forslag ({p.bulk.acceptable})
          </Button>
          <Button size="sm" variant="outline" disabled={!p.canWrite || p.bulk.busy} onClick={p.bulk.onNotApplicable}>
            Marker ikke råvare
          </Button>
          <Button size="sm" variant="outline" disabled={!p.canWrite || p.bulk.busy} onClick={p.bulk.onCreate}>
            Opprett råvarer for valgte
          </Button>
          <Button size="sm" variant="ghost" onClick={p.bulk.onClear}>
            Nullstill valg
          </Button>
          {p.bulk.acceptable < p.bulk.count && (
            <span className="text-caption text-ink-secondary">
              Bare linjer der det eneste som gjenstår er å bekrefte råvareforslaget kan godtas samlet.
            </span>
          )}
        </Card>
      )}

      <QueryState
        scope="fakturaer:innboks-linjer"
        isLoading={p.loading}
        isError={!!p.error}
        error={p.error}
        isEmpty={p.lines.length === 0}
        emptyTitle={p.emptyTitle}
        onRetry={p.onRetry}
      >
        {p.isMobile ? (
          panel
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(280px,2fr)_3fr]">
            <Card className="max-h-[calc(100vh-10rem)] overflow-y-auto p-0 lg:sticky lg:top-4">
              <LineList
                lines={p.lines}
                statusOf={p.statusOf}
                activeLineId={p.activeLine?.id ?? null}
                onSelect={p.onSelect}
                selected={p.selected}
                onToggleSelect={p.onToggleSelect}
                showInvoice={p.showInvoice}
              />
            </Card>
            <div>{panel}</div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
