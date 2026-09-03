import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { ArrowRight, FileText, Globe, Repeat, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DeskSectionState } from "./DeskSectionState";
import type { DeskRow } from "@/ordre/hooks/useOrderDeskBoard";
import { formatDateLong } from "@/ordre/lib/format";

/** Maks antall fastordre-rader i kortet — resten telles i «+N flere». */
export const AUTOMATION_MAX_ROWS = 5;

export type AutomationSource<T> = T & {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  to: string;
};

export type AutomationRunsCardProps = {
  /** Dato fastordre-seksjonen gjelder for. */
  recurringDate: string;
  onChangeRecurringDate: (date: string) => void;
  dates: { today: string; tomorrow: string; dayAfter: string };
  recurring: AutomationSource<{ rows: DeskRow[]; total: number }>;
  website: AutomationSource<{ count: number }>;
  deliveryNotes: AutomationSource<{ count: number; mainRunDone: boolean; extraRuns: number }>;
};

function SubSection({
  icon: Icon,
  title,
  meta,
  to,
  toLabel,
  children,
}: {
  icon: typeof Repeat;
  title: string;
  meta?: string;
  to: string;
  toLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </h3>
        <Link
          to={to}
          className="shrink-0 whitespace-nowrap text-caption text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {toLabel}
        </Link>
      </div>
      {meta && <p className="text-caption text-muted-foreground">{meta}</p>}
      {children}
    </section>
  );
}

function StatusLine({
  value,
  label,
  tone = "default",
  badges,
}: {
  value: number;
  label: string;
  tone?: "default" | "warning" | "ok";
  badges?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-card px-3 py-2">
      <span
        className={cn(
          "text-xl font-semibold leading-none tabular-nums",
          tone === "warning"
            ? "text-[hsl(var(--alert-warning))]"
            : tone === "ok"
              ? "text-[hsl(var(--alert-success))]"
              : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-caption text-muted-foreground">{label}</span>
      {badges && <span className="ml-auto flex flex-wrap items-center gap-1.5">{badges}</span>}
    </div>
  );
}

function DateChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

/**
 * «Automatiske løp» — de tre maskinelle kildene ordrekontoret må kvittere ut
 * hver dag: fastordre, nettbutikkordre og pakkseddelkjøringen.
 *
 * Hver seksjon har sin egen laste-/feiltilstand, slik at én feilende kilde ikke
 * skjuler de to andre.
 */
export function AutomationRunsCard({
  recurringDate,
  onChangeRecurringDate,
  dates,
  recurring,
  website,
  deliveryNotes,
}: AutomationRunsCardProps) {
  const visibleRecurring = recurring.rows.slice(0, AUTOMATION_MAX_ROWS);
  const overflow = Math.max(0, recurring.total - visibleRecurring.length);

  return (
    <Card className="flex h-full min-w-0 flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Automatiske løp
        </CardTitle>
        <p className="mt-1 text-caption text-muted-foreground">
          Fastordre, nettbutikk og pakksedler — alt som kjører av seg selv og må kvitteres ut.
        </p>
      </CardHeader>

      <CardContent className="flex-1 space-y-4 pt-0">
        <SubSection
          icon={Repeat}
          title="Fastordre ikke kjørt"
          to={recurring.to}
          toLabel="Åpne fastordre"
        >
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Velg dato for fastordre">
            <DateChip
              label="I dag"
              active={recurringDate === dates.today}
              onClick={() => onChangeRecurringDate(dates.today)}
            />
            <DateChip
              label="I morgen"
              active={recurringDate === dates.tomorrow}
              onClick={() => onChangeRecurringDate(dates.tomorrow)}
            />
            <DateChip
              label="Overmorgen"
              active={recurringDate === dates.dayAfter}
              onClick={() => onChangeRecurringDate(dates.dayAfter)}
            />
          </div>
          <DeskSectionState
            isLoading={recurring.isLoading}
            isError={recurring.isError}
            error={recurring.error}
            onRetry={recurring.refetch}
            scope="ordre-desk/automation-recurring"
            isEmpty={visibleRecurring.length === 0}
            emptyText={`Alle fastordrekunder er regulert for ${formatDateLong(recurringDate)}.`}
            skeletonRows={2}
          >
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {visibleRecurring.map((row) => (
                <li key={row.id}>
                  <Link
                    to={row.to}
                    className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-foreground">
                        {row.primary}
                      </span>
                      {row.secondary && (
                        <span className="block truncate text-caption text-muted-foreground">
                          {row.secondary}
                        </span>
                      )}
                    </span>
                    {row.badge && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {row.badge}
                      </Badge>
                    )}
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
            {overflow > 0 && (
              <p className="mt-1.5 text-caption text-muted-foreground">
                +{overflow} flere —{" "}
                <Link to={recurring.to} className="text-primary hover:underline">
                  åpne fastordre
                </Link>
              </p>
            )}
          </DeskSectionState>
        </SubSection>

        <SubSection
          icon={Globe}
          title="Nettbutikkordre"
          to={website.to}
          toLabel="Åpne nettbutikk"
        >
          <DeskSectionState
            isLoading={website.isLoading}
            isError={website.isError}
            error={website.error}
            onRetry={website.refetch}
            scope="ordre-desk/automation-website"
            skeletonRows={1}
          >
            <StatusLine
              value={website.count}
              label="ordre til behandling"
              tone={website.count > 0 ? "warning" : "ok"}
            />
          </DeskSectionState>
        </SubSection>

        <SubSection
          icon={FileText}
          title="Pakksedler i dag"
          meta={formatDateLong(dates.today)}
          to={deliveryNotes.to}
          toLabel="Åpne pakksedler"
        >
          <DeskSectionState
            isLoading={deliveryNotes.isLoading}
            isError={deliveryNotes.isError}
            error={deliveryNotes.error}
            onRetry={deliveryNotes.refetch}
            scope="ordre-desk/automation-delivery-notes"
            skeletonRows={1}
          >
            <StatusLine
              value={deliveryNotes.count}
              label="pakksedler produsert"
              badges={
                <>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      deliveryNotes.mainRunDone
                        ? "border-[hsl(var(--alert-success))]/40 bg-[hsl(var(--alert-success))]/10 text-[hsl(var(--alert-success))]"
                        : "border-[hsl(var(--alert-warning))]/40 bg-[hsl(var(--alert-warning))]/10 text-[hsl(var(--alert-warning))]",
                    )}
                  >
                    {deliveryNotes.mainRunDone ? "Hovedkjøring kjørt" : "Hovedkjøring ikke kjørt"}
                  </Badge>
                  {deliveryNotes.extraRuns > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {deliveryNotes.extraRuns} tilleggskjøring
                      {deliveryNotes.extraRuns === 1 ? "" : "er"}
                    </Badge>
                  )}
                </>
              }
            />
          </DeskSectionState>
        </SubSection>


      </CardContent>
    </Card>
  );
}
