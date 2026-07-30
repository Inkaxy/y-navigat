import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, formatDistanceToNow, subDays, startOfDay, differenceInHours } from "date-fns";
import { nb } from "date-fns/locale";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  DoorOpen,
  FileWarning,
  HeartPulse,
  Link2,
  Loader2,
  ReceiptText,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fetchAllRows } from "@/lib/supabasePaging";

// ── Types ─────────────────────────────────────────────────────────────────
type Traffic = "green" | "amber" | "red";

interface TerminalRow {
  id: string;
  terminal_code: string;
  display_name: string;
  outlet_name: string | null;
  outlet_id: string | null;
}

interface JournalVerification {
  terminal_id: string;
  verified_at: string;
  is_valid: boolean;
  error_message: string | null;
  total_events: number;
  broken_at_id: number | null;
}

interface ZReport {
  terminal_id: string;
  z_number: number;
  closed_at: string;
  cash_variance_total: number | null;
  variance_flagged: boolean | null;
  variance_threshold: number | null;
}

interface SafTExport {
  terminal_id: string | null;
  period_end: string;
  status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────
const fmtNok = (n: number | null | undefined) =>
  new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(n ?? 0);

const trafficBadgeClass: Record<Traffic, string> = {
  green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  red: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
};

const trafficDotClass: Record<Traffic, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

function TrafficDot({ level }: { level: Traffic }) {
  return <span className={cn("inline-block h-2.5 w-2.5 rounded-full", trafficDotClass[level])} />;
}

function relative(d: string | null | undefined) {
  if (!d) return "–";
  return formatDistanceToNow(new Date(d), { addSuffix: true, locale: nb });
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function KasseHelse() {
  const { activeEntityId: selectedEntityId } = useLegalEntity();

  // Terminals for entity
  const { data: terminals = [], isLoading: terminalsLoading } = useQuery({
    queryKey: ["kasse-helse", "terminals", selectedEntityId],
    enabled: !!selectedEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_terminals")
        .select("id, terminal_code, display_name, outlet_id, outlets:outlet_id(short_name)")
        .eq("legal_entity_id", selectedEntityId!)
        .eq("status", "active")
        .order("terminal_code");
      if (error) throw error;
      return (data ?? []).map((t: any) => ({
        id: t.id,
        terminal_code: t.terminal_code,
        display_name: t.display_name,
        outlet_id: t.outlet_id,
        outlet_name: t.outlets?.short_name ?? null,
      })) as TerminalRow[];
    },
  });

  const terminalIds = useMemo(() => terminals.map((t) => t.id), [terminals]);

  // Latest verification per terminal — fetch recent and reduce
  const { data: verifications = [], isLoading: verLoading } = useQuery({
    queryKey: ["kasse-helse", "verifications", terminalIds.join(",")],
    enabled: terminalIds.length > 0,
    queryFn: async () => {
      const data = await fetchAllRows<JournalVerification>((from, to) =>
        supabase
          .from("pos_journal_verifications")
          .select("terminal_id, verified_at, is_valid, error_message, total_events, broken_at_id")
          .in("terminal_id", terminalIds)
          .order("verified_at", { ascending: false })
          .range(from, to),
      );
      return data;
    },
  });
  const latestVerByTerminal = useMemo(() => {
    const m = new Map<string, JournalVerification>();
    for (const v of verifications) {
      if (!m.has(v.terminal_id)) m.set(v.terminal_id, v);
    }
    return m;
  }, [verifications]);

  // Latest Z-report per terminal
  const { data: zReports = [], isLoading: zLoading } = useQuery({
    queryKey: ["kasse-helse", "z-reports", terminalIds.join(",")],
    enabled: terminalIds.length > 0,
    queryFn: async () => {
      const data = await fetchAllRows<ZReport>((from, to) =>
        supabase
          .from("pos_z_reports")
          .select("terminal_id, z_number, closed_at, cash_variance_total, variance_flagged, variance_threshold")
          .in("terminal_id", terminalIds)
          .order("closed_at", { ascending: false })
          .range(from, to),
      );
      return data;
    },
  });
  const latestZByTerminal = useMemo(() => {
    const m = new Map<string, ZReport>();
    for (const z of zReports) {
      if (!m.has(z.terminal_id)) m.set(z.terminal_id, z);
    }
    return m;
  }, [zReports]);

  // Cash variance trend — last 30 days of Z-reports (aggregated per day)
  const varianceTrend = useMemo(() => {
    const cutoff = subDays(new Date(), 30);
    const byDay = new Map<string, { day: string; sum: number; flagged: number }>();
    for (const z of zReports) {
      const d = new Date(z.closed_at);
      if (d < cutoff) continue;
      const key = format(d, "yyyy-MM-dd");
      const entry = byDay.get(key) ?? { day: key, sum: 0, flagged: 0 };
      entry.sum += Number(z.cash_variance_total ?? 0);
      if (z.variance_flagged) entry.flagged += 1;
      byDay.set(key, entry);
    }
    return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [zReports]);

  // Journal events last 7 days: drawer_open_outside_sale + receipt_copy
  const last7Cutoff = useMemo(() => subDays(new Date(), 7).toISOString(), []);
  const { data: journalCounts = { drawer: new Map(), receiptCopy: new Map() }, isLoading: jLoading } = useQuery({
    queryKey: ["kasse-helse", "journal-counts", terminalIds.join(","), last7Cutoff],
    enabled: terminalIds.length > 0,
    queryFn: async () => {
      const data = await fetchAllRows<any>((from, to) =>
        supabase
          .from("pos_journal_events")
          .select("terminal_id, event_type")
          .in("terminal_id", terminalIds)
          .in("event_type", ["drawer_open_outside_sale", "receipt_copy"])
          .gte("event_time", last7Cutoff)
          .range(from, to),
      );
      const drawer = new Map<string, number>();
      const receiptCopy = new Map<string, number>();
      for (const r of data ?? []) {
        const tid = (r as any).terminal_id as string;
        if ((r as any).event_type === "drawer_open_outside_sale") {
          drawer.set(tid, (drawer.get(tid) ?? 0) + 1);
        } else {
          receiptCopy.set(tid, (receiptCopy.get(tid) ?? 0) + 1);
        }
      }
      return { drawer, receiptCopy };
    },
  });

  // Kvitteringsdekning siste 7 dager: hvert salg MÅ ha en receipt_delivered-
  // hendelse. Dette måles faktisk — det holder ikke å påstå at kioskappen
  // håndhever det.
  const { data: receiptCoverage, isLoading: rcLoading } = useQuery({
    queryKey: ["kasse-helse", "receipt-coverage", terminalIds.join(","), last7Cutoff],
    enabled: terminalIds.length > 0,
    queryFn: async () => {
      const [txs, evs] = await Promise.all([
        fetchAllRows<{ id: string }>((from, to) =>
          supabase
            .from("pos_transactions")
            .select("id")
            .in("terminal_id", terminalIds)
            .eq("is_training", false)
            .gte("created_at", last7Cutoff)
            .range(from, to),
        ),
        fetchAllRows<{ transaction_id: string | null }>((from, to) =>
          supabase
            .from("pos_journal_events")
            .select("transaction_id")
            .in("terminal_id", terminalIds)
            .eq("event_type", "receipt_delivered")
            .gte("event_time", last7Cutoff)
            .range(from, to),
        ),
      ]);
      const delivered = new Set(evs.map((e) => e.transaction_id).filter(Boolean));
      const total = txs.length;
      const missing = txs.filter((t) => !delivered.has(t.id)).length;
      return { total, missing };
    },
  });

  // Latest SAF-T export per terminal (and legal entity-wide)
  const { data: safT = [] } = useQuery({
    queryKey: ["kasse-helse", "saf-t", selectedEntityId],
    enabled: !!selectedEntityId,
    queryFn: async () => {
      const data = await fetchAllRows<SafTExport & { created_at: string }>((from, to) =>
        supabase
          .from("pos_saf_t_exports")
          .select("terminal_id, period_end, status, created_at")
          .eq("legal_entity_id", selectedEntityId!)
          .eq("status", "ready")
          .order("period_end", { ascending: false })
          .range(from, to),
      );
      return data;
    },
  });
  const latestSafTByTerminal = useMemo(() => {
    const m = new Map<string | null, SafTExport & { created_at: string }>();
    for (const s of safT) {
      const key = s.terminal_id ?? null;
      if (!m.has(key)) m.set(key, s);
    }
    return m;
  }, [safT]);
  const latestSafTEntityWide = safT[0] ?? null;

  // Per-terminal rows with traffic light
  const terminalHealth = useMemo(() => {
    const now = new Date();
    return terminals.map((t) => {
      const ver = latestVerByTerminal.get(t.id);
      const z = latestZByTerminal.get(t.id);
      const drawerCount = (journalCounts as any).drawer?.get(t.id) ?? 0;
      const receiptCopyCount = (journalCounts as any).receiptCopy?.get(t.id) ?? 0;

      // Journal traffic
      let journal: Traffic = "green";
      let journalNote = "OK";
      if (!ver) {
        journal = "amber";
        journalNote = "Ingen verifisering registrert";
      } else if (!ver.is_valid) {
        journal = "red";
        journalNote = ver.error_message ?? "Kjeden er brutt";
      } else if (differenceInHours(now, new Date(ver.verified_at)) > 36) {
        journal = "amber";
        journalNote = `Sist verifisert ${relative(ver.verified_at)}`;
      }

      // Z-report traffic: expect a Z each business day; >36h since last = red
      let zTraffic: Traffic = "green";
      let zNote = "Innenfor frist";
      if (!z) {
        zTraffic = "red";
        zNote = "Aldri fått Z-rapport";
      } else {
        const hoursSince = differenceInHours(now, new Date(z.closed_at));
        if (hoursSince > 48) {
          zTraffic = "red";
          zNote = `Sist Z ${relative(z.closed_at)}`;
        } else if (hoursSince > 30) {
          zTraffic = "amber";
          zNote = `Sist Z ${relative(z.closed_at)}`;
        }
      }

      // Overall
      const order: Traffic[] = ["red", "amber", "green"];
      const overall: Traffic = order.find((lvl) => journal === lvl || zTraffic === lvl) ?? "green";

      return {
        terminal: t,
        ver,
        z,
        drawerCount,
        receiptCopyCount,
        journal,
        journalNote,
        zTraffic,
        zNote,
        overall,
      };
    });
  }, [terminals, latestVerByTerminal, latestZByTerminal, journalCounts]);

  // Checklist mirroring the product declaration
  const checklist = useMemo(() => {
    const items: { label: string; level: Traffic; detail: string }[] = [];

    // 1. Journal integrity
    const badJournals = terminalHealth.filter((r) => r.journal === "red").length;
    const staleJournals = terminalHealth.filter((r) => r.journal === "amber").length;
    items.push({
      label: "Elektronisk journal — hash-kjede intakt",
      level: badJournals > 0 ? "red" : staleJournals > 0 ? "amber" : "green",
      detail:
        badJournals > 0
          ? `${badJournals} terminal(er) har brutt kjede — undersøk umiddelbart`
          : staleJournals > 0
          ? `${staleJournals} terminal(er) mangler fersk verifisering (>36 t)`
          : "Alle kjeder verifisert siste døgn",
    });

    // 2. Daily Z-report
    const missingZ = terminalHealth.filter((r) => r.zTraffic === "red").length;
    const lateZ = terminalHealth.filter((r) => r.zTraffic === "amber").length;
    items.push({
      label: "Daglig dagsavslutning (Z-rapport) per terminal",
      level: missingZ > 0 ? "red" : lateZ > 0 ? "amber" : "green",
      detail:
        missingZ > 0
          ? `${missingZ} terminal(er) mangler Z siste 48 t`
          : lateZ > 0
          ? `${lateZ} terminal(er) nærmer seg fristen`
          : "Alle terminaler har fersk Z-rapport",
    });

    // 3. Cash drawer control
    const totalDrawer = Array.from((journalCounts as any).drawer?.values() ?? []).reduce(
      (a: number, b: unknown) => a + Number(b ?? 0),
      0,
    ) as number;
    items.push({
      label: "Skuffåpninger uten salg loggføres med begrunnelse",
      level: totalDrawer > 20 ? "amber" : "green",
      detail: `${totalDrawer} åpning(er) uten salg siste 7 dager`,
    });

    // 4. Receipt copies
    const totalCopies = Array.from((journalCounts as any).receiptCopy?.values() ?? []).reduce(
      (a: number, b: unknown) => a + Number(b ?? 0),
      0,
    ) as number;
    items.push({
      label: "Kvitteringskopier begrenset og journalført",
      level: totalCopies > 30 ? "amber" : "green",
      detail: `${totalCopies} kopi(er) skrevet ut siste 7 dager`,
    });

    // 5. Cash variance trend
    const flaggedZ = zReports.filter((z) => z.variance_flagged).length;
    const bigVariance = zReports.some(
      (z) => Math.abs(Number(z.cash_variance_total ?? 0)) > Number(z.variance_threshold ?? 100),
    );
    items.push({
      label: "Kontantavvik under grenseverdi (kr 100)",
      level: bigVariance ? "amber" : "green",
      detail: flaggedZ
        ? `${flaggedZ} Z-rapport(er) med flagget avvik totalt`
        : "Ingen flaggede kontantavvik",
    });

    // 6. SAF-T Cash Register export
    const lastSafT = latestSafTEntityWide?.created_at ?? null;
    const daysSinceSafT = lastSafT ? Math.round((Date.now() - new Date(lastSafT).getTime()) / 86_400_000) : null;
    items.push({
      label: "SAF-T Cash Register-eksport tilgjengelig ved forespørsel",
      level: !lastSafT ? "red" : daysSinceSafT! > 90 ? "amber" : "green",
      detail: !lastSafT
        ? "Aldri generert — nødvendig for etterlevelse"
        : `Sist eksportert ${relative(lastSafT)}`,
    });

    // 7. Kvitteringsproduksjon — MÅLT, ikke antatt
    const rc = receiptCoverage;
    items.push({
      label: "Alle salg har kvittering (receipt_delivered)",
      level: !rc ? "amber" : rc.missing === 0 ? "green" : rc.missing / Math.max(rc.total, 1) > 0.02 ? "red" : "amber",
      detail: !rc
        ? "Måling ikke lastet"
        : rc.total === 0
          ? "Ingen salg siste 7 dager"
          : rc.missing === 0
            ? `${rc.total} salg siste 7 dager — alle journalført med kvittering`
            : `${rc.missing} av ${rc.total} salg siste 7 dager mangler kvitteringshendelse`,
    });

    // 8. Uforanderlighet — målt via hash-kjedeverifiseringene
    const verified = terminalHealth.filter((r) => r.journal === "green").length;
    const broken = terminalHealth.filter((r) => r.journal === "red").length;
    const unverified = terminalHealth.length - verified - broken;
    items.push({
      label: "Registreringer kan ikke endres eller slettes (hash-kjede verifisert)",
      level: broken > 0 ? "red" : unverified > 0 ? "amber" : "green",
      detail:
        terminalHealth.length === 0
          ? "Ingen terminaler"
          : `${verified} av ${terminalHealth.length} terminaler verifisert OK` +
            (broken ? `, ${broken} med brutt kjede` : "") +
            (unverified ? `, ${unverified} uten fersk verifisering` : ""),
    });

    return items;
  }, [terminalHealth, journalCounts, zReports, latestSafTEntityWide, receiptCoverage]);

  // KPIs
  const kpis = useMemo(() => {
    const brokenChains = terminalHealth.filter((r) => r.journal === "red").length;
    const missingZ = terminalHealth.filter((r) => r.zTraffic === "red").length;
    const drawerTotal = Array.from((journalCounts as any).drawer?.values() ?? []).reduce(
      (a: number, b: unknown) => a + Number(b ?? 0),
      0,
    ) as number;
    const copyTotal = Array.from((journalCounts as any).receiptCopy?.values() ?? []).reduce(
      (a: number, b: unknown) => a + Number(b ?? 0),
      0,
    ) as number;
    return { brokenChains, missingZ, drawerTotal, copyTotal };
  }, [terminalHealth, journalCounts]);

  const loading = terminalsLoading || verLoading || zLoading || jLoading || rcLoading;

  if (!selectedEntityId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Velg et selskap i toppmenyen for å se kasse-helsen.</div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-bronze/10 text-brand-bronze">
            <HeartPulse className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Kassasystem-helse</h1>
            <p className="text-sm text-muted-foreground">
              Etterlevelse av kassasystemforskriften — journal, Z-rapporter, skuff og eksport.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/pos-styring/rapporter">
              <ReceiptText className="h-4 w-4" /> Rapporter
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/pos-styring/innstillinger/saf-t">
              <ShieldCheck className="h-4 w-4" /> SAF-T
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Brutte journalkjeder"
          value={kpis.brokenChains}
          tone={kpis.brokenChains > 0 ? "red" : "green"}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <KpiCard
          label="Manglende Z-rapporter"
          value={kpis.missingZ}
          tone={kpis.missingZ > 0 ? "red" : "green"}
          icon={<FileWarning className="h-4 w-4" />}
        />
        <KpiCard
          label="Skuffåpninger uten salg · 7 d"
          value={kpis.drawerTotal}
          tone={kpis.drawerTotal > 20 ? "amber" : "green"}
          icon={<DoorOpen className="h-4 w-4" />}
        />
        <KpiCard
          label="Kvitteringskopier · 7 d"
          value={kpis.copyTotal}
          tone={kpis.copyTotal > 30 ? "amber" : "green"}
          icon={<ReceiptText className="h-4 w-4" />}
        />
      </div>

      {/* Terminal health table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="h-4 w-4 text-brand-bronze" />
            Helse per terminal
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : terminalHealth.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Ingen aktive terminaler.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Terminal</TableHead>
                  <TableHead>Journal</TableHead>
                  <TableHead>Siste Z</TableHead>
                  <TableHead className="text-right">Skuff u/salg (7d)</TableHead>
                  <TableHead className="text-right">Kopier (7d)</TableHead>
                  <TableHead className="text-right">SAF-T</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terminalHealth.map((r) => {
                  const safT = latestSafTByTerminal.get(r.terminal.id) ?? latestSafTEntityWide;
                  return (
                    <TableRow key={r.terminal.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TrafficDot level={r.overall} />
                          <div>
                            <div className="font-medium">{r.terminal.terminal_code}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.terminal.display_name}
                              {r.terminal.outlet_name ? ` · ${r.terminal.outlet_name}` : ""}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("gap-1", trafficBadgeClass[r.journal])}>
                          {r.journal === "green" ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : r.journal === "amber" ? (
                            <AlertTriangle className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          {r.journalNote}
                        </Badge>
                        {r.ver && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {r.ver.total_events.toLocaleString("nb-NO")} hendelser · sist {relative(r.ver.verified_at)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("gap-1", trafficBadgeClass[r.zTraffic])}>
                          {r.zTraffic === "green" ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <AlertTriangle className="h-3 w-3" />
                          )}
                          {r.zNote}
                        </Badge>
                        {r.z && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Z-nr {r.z.z_number} · {fmtNok(Number(r.z.cash_variance_total ?? 0))} avvik
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.drawerCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.receiptCopyCount}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {safT ? format(new Date(safT.created_at), "d. MMM yyyy", { locale: nb }) : "–"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.z ? (
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/pos-styring/rapporter/z/${(r.z as any).id ?? ""}`}>
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Two-column: variance trend + checklist */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4 text-brand-bronze" />
              Kontantavvik siste 30 dager
            </CardTitle>
          </CardHeader>
          <CardContent>
            {varianceTrend.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Ingen Z-rapporter i perioden.</div>
            ) : (
              <VarianceSparkline data={varianceTrend} />
            )}
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Grønn ≤ 100 kr · Amber &gt; 100 kr · Rød flagget</span>
              <span>
                Sum:{" "}
                <strong className="text-foreground">
                  {fmtNok(varianceTrend.reduce((a, b) => a + b.sum, 0))}
                </strong>
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-brand-bronze" />
              Forskrifts-sjekkliste
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {checklist.map((c) => (
              <div key={c.label} className="flex items-start gap-3 rounded-md border bg-muted/20 p-3">
                <div className="mt-0.5">
                  <TrafficDot level={c.level} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{c.label}</div>
                  <div className="text-xs text-muted-foreground">{c.detail}</div>
                </div>
                <Badge variant="outline" className={cn("shrink-0", trafficBadgeClass[c.level])}>
                  {c.level === "green" ? "OK" : c.level === "amber" ? "Følg opp" : "Kritisk"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Oppdaterer…
        </div>
      )}
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: Traffic;
  icon: React.ReactNode;
}) {
  return (
    <Card className={cn("border-l-4", tone === "red" ? "border-l-red-500" : tone === "amber" ? "border-l-amber-500" : "border-l-emerald-500")}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", trafficBadgeClass[tone])}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Variance sparkline (pure SVG) ─────────────────────────────────────────
function VarianceSparkline({ data }: { data: { day: string; sum: number; flagged: number }[] }) {
  const w = 560;
  const h = 120;
  const pad = 8;
  const max = Math.max(100, ...data.map((d) => Math.abs(d.sum)));
  const step = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const midY = h / 2;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full">
      <line x1={pad} x2={w - pad} y1={midY} y2={midY} stroke="hsl(var(--border))" strokeDasharray="3 3" />
      {data.map((d, i) => {
        const x = pad + i * step;
        const val = Number(d.sum);
        const y = midY - (val / max) * (midY - pad);
        const barH = Math.abs(midY - y);
        const color =
          d.flagged > 0 ? "hsl(0 72% 55%)" : Math.abs(val) > 100 ? "hsl(38 90% 50%)" : "hsl(150 60% 40%)";
        return (
          <g key={d.day}>
            <rect
              x={x - Math.max(2, step / 3)}
              y={Math.min(y, midY)}
              width={Math.max(4, (step * 2) / 3)}
              height={Math.max(2, barH)}
              fill={color}
              opacity={0.85}
            />
          </g>
        );
      })}
    </svg>
  );
}
