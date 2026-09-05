import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
  ShieldAlert,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryState } from "@/components/common/QueryState";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { getStatusMeta } from "@/ordre/lib/orderStatus";
import { useDeliveryTours } from "@/ordre/hooks/useDeliveryTours";
import { useRecentOrdersForCustomer } from "@/ordre/hooks/useRecentOrdersForCustomer";
import { useDeliveryPausesForCustomer, isPaused } from "@/ordre/hooks/useDeliveryPausesForCustomer";
import {
  CREDIT_OVERRIDE_MIN_LENGTH,
  ISO_WEEKDAY_LABEL,
  customerStatusLabel,
  evaluateCustomerContext,
  isValidCreditOverrideReason,
} from "@/ordre/lib/customerContext";

const STORAGE_KEY = "nbhub:ordre:kundekontekst-apen";

export type CustomerContextCustomer = {
  id: string;
  customer_number: string;
  display_name: string;
  status?: string | null;
  credit_hold?: boolean | null;
  credit_hold_reason?: string | null;
  credit_days?: number | null;
  notes?: string | null;
  delivery_instructions?: string | null;
};

export type CustomerContextPanelProps = {
  customer: CustomerContextCustomer;
  /** Valgt leveringsdato (ISO) — styrer pausesjekken. */
  deliveryDate: string | null;
  /** Valgt tur, eller null når turen ikke er valgt ennå. */
  tourId?: string | null;
  /** Brukeren har skriverettigheter i Ordre og kan overstyre kredittstopp. */
  canOverrideCreditHold?: boolean;
  /** Begrunnelsen som er gitt for å overstyre kredittstopp. */
  creditOverrideReason?: string | null;
  onCreditOverrideChange?: (reason: string | null) => void;
  className?: string;
};

type RecurringRow = {
  id: string;
  name: string | null;
  valid_from: string | null;
  valid_to: string | null;
  recurring_order_items: Array<{ weekday: number | null; tour_id: string | null }> | null;
};

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function formatNok(value: number): string {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(value);
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** Kompakt kundekontekst for ordreregistrering: kredittstopp, pauser, faste dager, prisliste og siste ordre. */
export function CustomerContextPanel({
  customer,
  deliveryDate,
  tourId,
  canOverrideCreditHold = false,
  creditOverrideReason = null,
  onCreditOverrideChange,
  className,
}: CustomerContextPanelProps) {
  const [open, setOpen] = useState(readStoredOpen);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftReason, setDraftReason] = useState("");

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* localStorage kan være utilgjengelig — panelet fungerer uansett. */
      }
      return next;
    });
  }

  const customerId = customer.id;

  // 1) Faste leveringsdager/turer fra aktive fastordre-planer.
  const recurring = useQuery({
    queryKey: ["customer-context", "recurring", customerId],
    enabled: !!customerId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RecurringRow[]> => {
      const { data, error } = await supabase
        .from("recurring_order_schedules")
        .select("id, name, valid_from, valid_to, recurring_order_items(weekday, tour_id)")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("customer_id", customerId)
        .eq("is_active", true)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as RecurringRow[];
    },
  });

  // 2) Effektiv prisliste (navn).
  const priceList = useQuery({
    queryKey: ["customer-context", "price-list", customerId],
    enabled: !!customerId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data: id, error } = await supabase.rpc("customer_effective_price_list", {
        _customer_id: customerId,
      });
      if (error) throw error;
      const listId = (id as string | null) ?? null;
      if (!listId) return null;
      const { data: row, error: listErr } = await supabase
        .from("price_lists")
        .select("display_name")
        .eq("id", listId)
        .maybeSingle();
      if (listErr) throw listErr;
      return row?.display_name ?? null;
    },
  });

  // 3) Fem siste ordre.
  const recent = useRecentOrdersForCustomer(customerId, true);

  const pauseDate = deliveryDate ?? "";
  const pauses = useDeliveryPausesForCustomer(customerId, pauseDate, pauseDate);
  const pause = deliveryDate ? isPaused(pauses.data, deliveryDate, tourId ?? "*") : null;

  const tours = useDeliveryTours({ activeOnly: false });
  const tourNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tours.data ?? []) m.set(t.id, `#${t.tour_number} ${t.display_name}`);
    return m;
  }, [tours.data]);

  const evaluation = evaluateCustomerContext({
    creditHold: customer.credit_hold === true,
    creditHoldReason: customer.credit_hold_reason,
    creditOverrideReason,
    canOverrideCreditHold,
    status: customer.status,
    pause,
  });

  const fixedDays = useMemo(() => {
    const days = new Set<number>();
    const tourIds = new Set<string>();
    const today = new Date().toISOString().slice(0, 10);
    for (const s of recurring.data ?? []) {
      if (s.valid_from && s.valid_from > today) continue;
      if (s.valid_to && s.valid_to < today) continue;
      for (const it of s.recurring_order_items ?? []) {
        if (it.weekday) days.add(it.weekday);
        if (it.tour_id) tourIds.add(it.tour_id);
      }
    }
    return {
      weekdays: [...days].sort((a, b) => a - b),
      tours: [...tourIds],
    };
  }, [recurring.data]);

  const creditBlocked = customer.credit_hold === true && evaluation.blocked;

  return (
    <section
      className={`rounded-lg border border-border bg-card ${className ?? ""}`}
      aria-label="Kundekontekst"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={toggle}
          className="flex flex-1 items-center gap-2 text-left text-sm font-medium"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Kundekontekst
          {creditBlocked && (
            <Badge variant="destructive" className="gap-1">
              <ShieldAlert className="h-3 w-3" /> Kredittstopp
            </Badge>
          )}
          {!creditBlocked && evaluation.warnings.length > 0 && (
            <Badge variant="outline" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> {evaluation.warnings.length}
            </Badge>
          )}
        </button>
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to={`/kunder/kundeliste/${customer.id}`}>
            Åpne kundekort <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {/* Kredittstopp og advarsler vises alltid, også når panelet er lukket. */}
      <div className="space-y-2 px-3 pb-3">
        {customer.credit_hold === true && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <div className="font-medium">Kredittstopp</div>
                <div className="text-xs">
                  {customer.credit_hold_reason?.trim() || "Ingen begrunnelse registrert."}
                </div>
                {isValidCreditOverrideReason(creditOverrideReason) && canOverrideCreditHold ? (
                  <div className="mt-1 text-xs">
                    Overstyrt: {creditOverrideReason}
                    {onCreditOverrideChange && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto px-1 py-0 text-xs"
                        onClick={() => onCreditOverrideChange(null)}
                      >
                        Angre
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 text-xs">
                    Ordren kan ikke lagres.
                    {canOverrideCreditHold && onCreditOverrideChange ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-2 h-7"
                        onClick={() => {
                          setDraftReason(creditOverrideReason ?? "");
                          setDialogOpen(true);
                        }}
                      >
                        Overstyr med begrunnelse
                      </Button>
                    ) : (
                      " Kontakt ordrekontoret."
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {evaluation.warnings
          .filter((w) => !w.startsWith("Kredittstopp er overstyrt"))
          .map((w) => (
            <div
              key={w}
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-foreground"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}

        {open && (
          <div className="grid gap-3 pt-1 text-xs sm:grid-cols-2">
            <div className="space-y-1">
              <div className="font-medium text-foreground">Faste leveringsdager</div>
              <QueryState
                isLoading={recurring.isLoading}
                isError={recurring.isError}
                error={recurring.error}
                scope="ordre:kundekontekst:fastordre"
                onRetry={() => void recurring.refetch()}
                errorTitle="Kunne ikke hente faste leveringer"
                isEmpty={fixedDays.weekdays.length === 0}
                emptyTitle="Ingen faste leveringsdager"
                compact
                skeletonRows={1}
                skeletonRowClassName="h-5"
              >
                <div className="flex flex-wrap gap-1">
                  {fixedDays.weekdays.map((d) => (
                    <Badge key={d} variant="secondary">
                      {ISO_WEEKDAY_LABEL[d] ?? d}
                    </Badge>
                  ))}
                  {fixedDays.tours.map((t) => (
                    <Badge key={t} variant="outline">
                      {tourNameById.get(t) ?? "Ukjent tur"}
                    </Badge>
                  ))}
                </div>
              </QueryState>
            </div>

            <div className="space-y-1">
              <div className="font-medium text-foreground">Prisliste og vilkår</div>
              <QueryState
                isLoading={priceList.isLoading}
                isError={priceList.isError}
                error={priceList.error}
                scope="ordre:kundekontekst:prisliste"
                onRetry={() => void priceList.refetch()}
                errorTitle="Kunne ikke hente prisliste"
                compact
                skeletonRows={1}
                skeletonRowClassName="h-5"
              >
                <div className="text-muted-foreground">
                  <div>Prisliste: {priceList.data ?? "Standard"}</div>
                  {typeof customer.credit_days === "number" && (
                    <div>Betalingsvilkår: {customer.credit_days} dager</div>
                  )}
                  <div>Status: {customerStatusLabel(customer.status)}</div>
                </div>
              </QueryState>
            </div>

            {(customer.notes?.trim() || customer.delivery_instructions?.trim()) && (
              <div className="space-y-1 sm:col-span-2">
                <div className="font-medium text-foreground">Notater</div>
                {customer.notes?.trim() && (
                  <p className="flex items-start gap-1.5 whitespace-pre-wrap text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {customer.notes}
                  </p>
                )}
                {customer.delivery_instructions?.trim() && (
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    Leveringsinstruks: {customer.delivery_instructions}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1 sm:col-span-2">
              <div className="font-medium text-foreground">Siste ordre</div>
              <QueryState
                isLoading={recent.isLoading}
                isError={recent.isError}
                error={recent.error}
                scope="ordre:kundekontekst:siste-ordre"
                onRetry={() => void recent.refetch()}
                errorTitle="Kunne ikke hente siste ordre"
                isEmpty={(recent.data ?? []).length === 0}
                emptyTitle="Ingen tidligere ordre"
                compact
                skeletonRows={3}
                skeletonRowClassName="h-5"
              >
                <ul className="divide-y divide-border">
                  {(recent.data ?? []).map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 py-1">
                      <Link
                        to={`/ordre/ordrer/${o.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {o.order_number}
                      </Link>
                      <span className="text-muted-foreground">{formatDate(o.delivery_date)}</span>
                      <span className="text-muted-foreground">
                        {getStatusMeta(o.status).label}
                      </span>
                      <span className="tabular-nums">{formatNok(o.total_incl_vat)}</span>
                    </li>
                  ))}
                </ul>
              </QueryState>
            </div>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Overstyr kredittstopp</DialogTitle>
            <DialogDescription>
              Begrunnelsen lagres i ordrens interne notat. Minst {CREDIT_OVERRIDE_MIN_LENGTH} tegn.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={draftReason}
            onChange={(e) => setDraftReason(e.target.value)}
            placeholder="Hvorfor skal ordren likevel registreres?"
            rows={4}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Avbryt
            </Button>
            <Button
              disabled={!isValidCreditOverrideReason(draftReason)}
              onClick={() => {
                onCreditOverrideChange?.(draftReason.trim());
                setDialogOpen(false);
              }}
            >
              Lagre begrunnelse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
