import { SlidersHorizontal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/common/QueryState";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { SupplierLinkContext } from "@/fakturaer/hooks/useSupplierLinkContext";
import type { LineStatus } from "@/fakturaer/lib/lineStatus";
import { GROUP_LABELS, REVIEW_GROUPS, type QueueSort, type ReviewGroup } from "@/fakturaer/lib/reviewReasons";
import { LineList } from "@/fakturaer/components/inbox/LineList";
import { LineTask, type SecondaryAction } from "@/fakturaer/components/inbox/task/LineTask";

const SORT_OPTIONS: { value: QueueSort; label: string }[] = [
  { value: "invoice_date", label: "Nyeste faktura først" },
  { value: "impact", label: "Størst kronepåvirkning først" },
  { value: "repeats", label: "Går oftest igjen først" },
];

export interface QueueWorkspaceProps {
  lines: ReviewLineRow[];
  statusOf: (l: ReviewLineRow) => LineStatus;
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  needsCount: number;
  reason: ReviewGroup | "all";
  onReason: (r: ReviewGroup | "all") => void;
  sort: QueueSort;
  onSort: (s: QueueSort) => void;
  multiSelect: boolean;
  onMultiSelect: (v: boolean) => void;
  selected: Record<string, boolean>;
  onToggleSelect: (id: string, v: boolean) => void;
  bulk: { count: number; acceptable: number; busy: boolean; onAccept: () => void; onNotApplicable: () => void; onCreate: () => void; onClear: () => void };
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  emptyTitle: string;
  activeLine: ReviewLineRow | null;
  onSelect: (l: ReviewLineRow) => void;
  onPrev: () => void;
  onNext: () => void;
  links: SupplierLinkContext;
  toleranceFor: (legalEntityId: string | null, category?: string | null) => number;
  showInvoice: boolean;
  canWrite: boolean;
  reconcileReady: boolean;
  isMobile: boolean;
  countsError: boolean;
  onSaved: (lineId: string) => Promise<void>;
  onSecondary: (a: SecondaryAction, l: ReviewLineRow) => void;
  onShowDocument: (l: ReviewLineRow) => void;
  onReconcile: () => void;
}

/** Smal linjeliste til venstre, valgt oppgave til høyre. Alt sekundært ligger under «Flere valg». */
export function QueueWorkspace(p: QueueWorkspaceProps) {
  const index = p.activeLine ? p.lines.findIndex((l) => l.id === p.activeLine?.id) : -1;
  const a = p.activeLine;
  const task = a ? (
    <LineTask
      key={a.id}
      line={a}
      status={p.statusOf(a)}
      link={p.links.forLine(a)}
      tolerancePct={p.toleranceFor(a.invoice.legal_entity_id, a.matched_raw_material?.category ?? a.suggestions?.[0]?.raw_material?.category ?? null)}
      position={{ index: Math.max(index, 0), total: p.lines.length }}
      canWrite={p.canWrite}
      reconcileReady={p.reconcileReady}
      onPrev={p.onPrev}
      onNext={p.onNext}
      onSaved={p.onSaved}
      onSecondary={p.onSecondary}
      onShowDocument={p.onShowDocument}
      onReconcile={p.onReconcile}
    />
  ) : null;

  const toolbar = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Switch id="vis-alle-linjer" checked={p.showAll} onCheckedChange={p.onShowAll} />
        <Label htmlFor="vis-alle-linjer" className="text-sm">
          Vis alle linjer
        </Label>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5">
            <SlidersHorizontal className="h-4 w-4" /> Flere valg
            {p.reason !== "all" ? " (1)" : ""}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <div className="space-y-1">
            <Label className="text-caption">Årsak</Label>
            <Select value={p.reason} onValueChange={(v) => p.onReason(v as ReviewGroup | "all")}>
              <SelectTrigger aria-label="Filtrer på årsak">
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
          </div>
          <div className="space-y-1">
            <Label className="text-caption">Sortering</Label>
            <Select value={p.sort} onValueChange={(v) => p.onSort(v as QueueSort)}>
              <SelectTrigger aria-label="Sorter linjene">
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
          </div>
          {!p.isMobile && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={p.multiSelect} onCheckedChange={(v) => p.onMultiSelect(!!v)} />
              Velg flere linjer samtidig
            </label>
          )}
          <p className="text-caption text-ink-secondary">
            Hurtigtaster: ↑/↓ bytt linje · Enter godta råvareforslag · m velg råvare · n ny råvare · x ikke råvare · u angre
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className="space-y-3">
      {p.countsError && <p className="text-caption text-destructive">Tellerne kunne ikke hentes — tallene kan være ufullstendige.</p>}
      {p.multiSelect && p.bulk.count > 0 && (
        <Card className="flex flex-wrap items-center gap-2 border-primary/30 bg-primary/5 p-3">
          <span className="text-sm font-medium">{p.bulk.count} valgt</span>
          <Button size="sm" disabled={!p.canWrite || p.bulk.busy || p.bulk.acceptable === 0} onClick={p.bulk.onAccept}>
            Godta forslag ({p.bulk.acceptable})
          </Button>
          <Button size="sm" variant="outline" disabled={!p.canWrite || p.bulk.busy} onClick={p.bulk.onNotApplicable}>
            Marker ikke råvare
          </Button>
          <Button size="sm" variant="outline" disabled={!p.canWrite || p.bulk.busy} onClick={p.bulk.onCreate}>
            Opprett råvarer
          </Button>
          <Button size="sm" variant="ghost" onClick={p.bulk.onClear}>
            Nullstill
          </Button>
          <span className="w-full text-caption text-ink-secondary">
            Bare linjer der det eneste som gjenstår er å bekrefte råvareforslaget godtas samlet.
          </span>
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
          <div className="space-y-3">
            {toolbar}
            {task}
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(240px,300px)_1fr]">
            <div className="space-y-2 lg:sticky lg:top-4">
              {toolbar}
              <Card className="max-h-[calc(100vh-12rem)] overflow-y-auto p-0">
                <LineList
                  lines={p.lines}
                  statusOf={p.statusOf}
                  activeLineId={a?.id ?? null}
                  onSelect={p.onSelect}
                  selected={p.selected}
                  onToggleSelect={p.onToggleSelect}
                  showInvoice={p.showInvoice}
                  selectable={p.multiSelect}
                />
              </Card>
            </div>
            <div>{task}</div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
