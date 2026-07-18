import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Monitor, AlertTriangle } from "lucide-react";
import {
  aggregateToday,
  fetchLatestZ,
  fetchOpenSessions,
  fetchTerminals,
  fetchTodayTransactions,
  fetchVarianceAlerts,
  verifyJournalChain,
  fmtMoney,
  type JournalChainResult,
} from "@/pos_styring/lib/dashboardQueries";
import { DashboardKpiRow } from "@/pos_styring/components/DashboardKpiRow";
import { TerminalStatusCard } from "@/pos_styring/components/TerminalStatusCard";
import type { JournalState } from "@/pos_styring/components/JournalBadge";

const Dashboard = () => {
  const qc = useQueryClient();

  const terminalsQ = useQuery({
    queryKey: ["pos-styring", "dash", "terminals"],
    queryFn: fetchTerminals,
  });
  const sessionsQ = useQuery({
    queryKey: ["pos-styring", "dash", "open-sessions"],
    queryFn: fetchOpenSessions,
  });
  const txnsQ = useQuery({
    queryKey: ["pos-styring", "dash", "today-txns"],
    queryFn: fetchTodayTransactions,
  });
  const zQ = useQuery({
    queryKey: ["pos-styring", "dash", "latest-z"],
    queryFn: fetchLatestZ,
  });

  const terminals = terminalsQ.data ?? [];
  const sessions = sessionsQ.data ?? [];
  const txns = txnsQ.data ?? [];
  const latestZ = zQ.data ?? new Map();

  const agg = useMemo(() => aggregateToday(txns), [txns]);
  const sessionsByTerminal = useMemo(() => {
    const m = new Map<string, (typeof sessions)[number]>();
    for (const s of sessions) m.set(s.terminal_id, s);
    return m;
  }, [sessions]);

  const [journal, setJournal] = useState<Record<string, JournalState>>({});
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});

  const verifyOne = useCallback(async (terminalId: string) => {
    setRefreshing((m) => ({ ...m, [terminalId]: true }));
    setJournal((m) => ({ ...m, [terminalId]: { status: "loading" } }));
    try {
      const result: JournalChainResult = await verifyJournalChain(terminalId);
      setJournal((m) => ({ ...m, [terminalId]: { status: "ok", result } }));
    } catch (e: any) {
      setJournal((m) => ({
        ...m,
        [terminalId]: { status: "error", message: e?.message },
      }));
    } finally {
      setRefreshing((m) => ({ ...m, [terminalId]: false }));
    }
  }, []);

  const verifyAll = useCallback(async () => {
    await Promise.all(terminals.map((t) => verifyOne(t.id)));
  }, [terminals, verifyOne]);

  // Auto-verifiser ved første lasting av terminaler
  useEffect(() => {
    if (terminals.length === 0) return;
    const missing = terminals.filter((t) => !journal[t.id]);
    if (missing.length === 0) return;
    Promise.all(missing.map((t) => verifyOne(t.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminals]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["pos-styring", "dash"] });
    verifyAll();
  };

  const anyLoading =
    terminalsQ.isLoading || sessionsQ.isLoading || txnsQ.isLoading || zQ.isLoading;
  const anyError = terminalsQ.error || sessionsQ.error || txnsQ.error || zQ.error;

  const terminalsActive = terminals.filter((t) => t.status === "active").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Oversikt</h1>
          <p className="text-sm text-muted-foreground">
            Status for kassesystemet i dag — per terminal og totalt.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={anyLoading}>
            <RefreshCw className={`h-4 w-4 ${anyLoading ? "animate-spin" : ""}`} />
            <span className="ml-1">Oppdater</span>
          </Button>
          <Button variant="outline" size="sm" onClick={verifyAll} disabled={terminals.length === 0}>
            Verifiser alle
          </Button>
        </div>
      </div>

      <DashboardKpiRow
        loading={anyLoading}
        grossNet={agg.total.gross_net}
        saleCount={agg.total.sale_count}
        openSessions={sessions.length}
        terminalsActive={terminalsActive}
        terminalsTotal={terminals.length}
      />

      {anyError && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Klarte ikke laste alle data. Prøv "Oppdater" igjen.
        </Card>
      )}

      {anyLoading && terminals.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : terminals.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Monitor className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-base font-semibold">Ingen terminaler tilgjengelig</p>
            <p className="text-sm text-muted-foreground">
              Du har ikke synlighet til noen kasse-terminaler ennå.
            </p>
          </div>
          <Link
            to="/pos-styring/terminaler"
            className="text-sm font-medium text-app-dark hover:underline"
          >
            Gå til terminal-administrasjon →
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {terminals.map((t) => (
            <TerminalStatusCard
              key={t.id}
              terminal={t}
              openSession={sessionsByTerminal.get(t.id) ?? null}
              todayAgg={agg.perTerminal.get(t.id) ?? { gross_net: 0, sale_count: 0 }}
              latestZ={latestZ.get(t.id) ?? null}
              journalState={journal[t.id] ?? { status: "loading" }}
              refreshing={refreshing[t.id]}
              onVerify={() => verifyOne(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
