import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import {
  fmtMoney,
  type LatestZRow,
  type OpenSessionRow,
  type TerminalAgg,
  type TerminalRow,
} from "@/pos_styring/lib/dashboardQueries";
import { JournalBadge, type JournalState } from "./JournalBadge";

interface Props {
  terminal: TerminalRow;
  openSession: OpenSessionRow | null;
  todayAgg: TerminalAgg;
  latestZ: LatestZRow | null;
  journalState: JournalState;
  refreshing?: boolean;
  onVerify: () => void;
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("nb-NO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function TerminalStatusCard({
  terminal,
  openSession,
  todayAgg,
  latestZ,
  journalState,
  refreshing,
  onVerify,
}: Props) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight">{terminal.display_name}</h3>
          <p className="text-xs text-muted-foreground">{terminal.terminal_code}</p>
        </div>
        {openSession ? (
          <Badge className="gap-1.5 bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300">
            Åpen
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">Lukket</Badge>
        )}
      </div>

      {openSession && (
        <div className="text-xs text-muted-foreground">
          {openSession.operator_display_name ?? "Ukjent operatør"}
          {openSession.session_number != null && (
            <> · sesjon #{openSession.session_number}</>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Omsetning i dag</p>
          <p className="text-lg font-semibold tabular-nums">{fmtMoney(todayAgg.gross_net)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Salg i dag</p>
          <p className="text-lg font-semibold tabular-nums">{todayAgg.sale_count}</p>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Siste Z:{" "}
        {latestZ ? (
          <span className="text-foreground">
            Z #{latestZ.z_number} · {fmtDate(latestZ.closed_at)}
          </span>
        ) : (
          <span>Ingen Z ennå</span>
        )}
      </div>

      <JournalBadge state={journalState} onRefresh={onVerify} refreshing={refreshing} />

      <div className="flex justify-end">
        <Link
          to="/pos-styring/sesjoner"
          className="inline-flex items-center gap-1 text-xs font-medium text-app-dark hover:underline"
        >
          Se sesjoner
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </Card>
  );
}
