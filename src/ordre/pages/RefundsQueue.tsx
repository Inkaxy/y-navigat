import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { ArrowLeft, Check, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useApproveRefund,
  useMarkRefundPaid,
  useMyOrdreScope,
  useRefunds,
  type RefundStatus,
  type RefundWithJoins,
} from "@/ordre/hooks/useRefunds";

const STATUS_LABEL: Record<RefundStatus, string> = {
  pending: "Venter godkjenning",
  approved: "Til behandling",
  paid: "Utbetalt",
  rejected: "Avvist",
};

const STATUS_STYLE: Record<RefundStatus, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  approved: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200",
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  rejected: "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200",
};

const ROUTE_STYLE = {
  utsalg: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200",
  okonomi: "border-purple-500/40 bg-purple-500/10 text-purple-800 dark:text-purple-200",
};

type FilterTab = "all" | RefundStatus;

export default function RefundsQueue() {
  const { data: refunds = [], isLoading } = useRefunds();
  const { data: scope } = useMyOrdreScope();
  const approve = useApproveRefund();
  const markPaid = useMarkRefundPaid();
  const [tab, setTab] = useState<FilterTab>("all");

  const isAdmin = scope?.level === "admin";
  const isOkonomi = !!scope?.isOkonomiTeam;
  const myOutlets = useMemo(() => new Set(scope?.outletIds ?? []), [scope?.outletIds]);

  const canApprove = (_: RefundWithJoins) => isAdmin;
  const canMarkPaid = (r: RefundWithJoins) => {
    if (r.requires_approval && r.status === "pending") return false;
    if (r.status === "paid" || r.status === "rejected") return false;
    if (r.route === "okonomi") return isOkonomi || isAdmin;
    if (r.route === "utsalg") {
      if (!r.outlet_id) return isAdmin;
      return isAdmin || myOutlets.has(r.outlet_id);
    }
    return false;
  };

  const filtered = useMemo(() => {
    if (tab === "all") return refunds;
    return refunds.filter((r) => r.status === tab);
  }, [refunds, tab]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: refunds.length, pending: 0, approved: 0, paid: 0, rejected: 0 };
    for (const r of refunds) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [refunds]);

  const onApprove = async (r: RefundWithJoins) => {
    try {
      await approve.mutateAsync(r);
      toast.success("Godkjent");
    } catch (e) {
      toast.error(`Feil: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onMarkPaid = async (r: RefundWithJoins) => {
    try {
      await markPaid.mutateAsync(r);
      toast.success("Merket som utbetalt");
    } catch (e) {
      toast.error(`Feil: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const TABS: { key: FilterTab; label: string }[] = [
    { key: "all", label: "Alle" },
    { key: "pending", label: "Venter godkjenning" },
    { key: "approved", label: "Til behandling" },
    { key: "paid", label: "Utbetalt" },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">
      {/* Header */}
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500/15 text-xl">
          💸
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tilbakebetalinger</h1>
          <p className="text-sm text-muted-foreground">
            Oppgaver rutet til den som faktisk kan betale tilbake — utsalg (kasse/POS) eller økonomi (kreditnota)
          </p>
        </div>
      </div>

      <Link
        to="/ordre/ticket"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Tilbake til innboksen
      </Link>

      <div className="mb-4 rounded-lg border border-sky-400/40 bg-sky-500/10 p-3 text-sm text-sky-900 dark:text-sky-200">
        💡 I NBHub styres denne køen av stillingstilgang: <b>Utsalg</b> ser bare sine (og får varsel + Hjem-widget),
        <b> Økonomi</b> ser kreditnotaene, og ordrekontoret ser status på alt de har opprettet.
        {` Beløp over ${approvalLimit} kr krever godkjenning fra daglig leder, og de som kan godkjenne får varsel.`}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              tab === t.key
                ? "border-[hsl(var(--brand-bronze))] bg-[hsl(var(--brand-bronze)/0.14)] text-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
            <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
              {counts[t.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-lg border bg-[hsl(var(--brand-cream))] p-8 text-center text-sm text-muted-foreground">
          Laster …
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-[hsl(var(--brand-cream))] p-8 text-center text-sm text-muted-foreground">
          Ingen tilbakebetalinger i denne visningen.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const routeBadge = (
              <span
                className={cn(
                  "inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  ROUTE_STYLE[r.route],
                )}
              >
                {r.route === "utsalg" ? (r.outlet?.short_name ?? "Utsalg") : "ØK"}
              </span>
            );
            return (
              <div
                key={r.id}
                className="rounded-lg border bg-[hsl(var(--brand-cream))] p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start gap-3">
                  {routeBadge}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-foreground">
                        {Number(r.amount).toFixed(2)} kr
                      </span>
                      <span className="text-sm text-muted-foreground">·</span>
                      <span className="text-sm font-medium text-foreground">
                        {r.ticket?.sender_name ?? r.ticket?.sender_email ?? "Ukjent kunde"}
                      </span>
                      {r.order?.order_number && (
                        <>
                          <span className="text-sm text-muted-foreground">·</span>
                          <Link
                            to={`/ordre/ordrer/${r.order.id}`}
                            className="text-sm font-medium text-foreground hover:underline"
                          >
                            Faktura {r.order.order_number}
                          </Link>
                        </>
                      )}
                    </div>
                    {r.reason && (
                      <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {r.reason}
                      </div>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">
                      opprettet {formatDistanceToNow(new Date(r.created_at), { locale: nb, addSuffix: true })}
                      {r.requires_approval && r.status === "pending" && ` · over ${approvalLimit} kr · venter godkjenning`}
                      {r.status === "approved" && " · godkjent ✓"}
                      {r.method && r.route === "utsalg" && ` · ${r.method}`}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
                      STATUS_STYLE[r.status],
                    )}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  {r.status === "pending" && r.requires_approval && canApprove(r) && (
                    <Button size="sm" onClick={() => onApprove(r)} disabled={approve.isPending}>
                      <Check className="mr-1 h-3.5 w-3.5" /> Godkjenn
                    </Button>
                  )}
                  {canMarkPaid(r) && (
                    <Button
                      size="sm"
                      className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => onMarkPaid(r)}
                      disabled={markPaid.isPending}
                    >
                      <Wallet className="h-3.5 w-3.5" />
                      Marker utbetalt
                    </Button>
                  )}
                  {r.ticket_id && (
                    <Link
                      to={`/ordre/ticket/${r.ticket_id}`}
                      className="ml-auto rounded-md border bg-background px-3 py-1 text-xs font-medium hover:bg-muted"
                    >
                      Åpne samtalen
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
