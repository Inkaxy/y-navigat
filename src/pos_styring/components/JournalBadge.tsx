import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import type { JournalChainResult } from "@/pos_styring/lib/dashboardQueries";

export type JournalState =
  | { status: "loading" }
  | { status: "ok"; result: JournalChainResult }
  | { status: "error"; message?: string };

interface Props {
  state: JournalState;
  onRefresh: () => void;
  refreshing?: boolean;
}

export function JournalBadge({ state, onRefresh, refreshing }: Props) {
  let badge: React.ReactNode;
  let helper: React.ReactNode = null;

  if (state.status === "loading") {
    badge = (
      <Badge variant="secondary" className="gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        Verifiserer…
      </Badge>
    );
  } else if (state.status === "error") {
    badge = (
      <Badge variant="outline" className="gap-1.5 text-muted-foreground">
        <ShieldQuestion className="h-3 w-3" />
        Kunne ikke verifisere
      </Badge>
    );
  } else if (state.result.is_valid) {
    badge = (
      <Badge variant="secondary" className="gap-1.5 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
        <ShieldCheck className="h-3 w-3" />
        Journal OK · {state.result.total_events} hendelser
      </Badge>
    );
  } else {
    const at = state.result.broken_at_id ?? "?";
    badge = (
      <Badge variant="destructive" className="gap-1.5">
        <ShieldAlert className="h-3 w-3" />
        Brudd ved hendelse #{at}
      </Badge>
    );
    helper = (
      <p className="text-xs text-muted-foreground">Kontakt plattform-ansvarlig</p>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {badge}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={onRefresh}
        disabled={refreshing || state.status === "loading"}
      >
        <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
        <span className="ml-1">Verifiser på nytt</span>
      </Button>
      {helper}
    </div>
  );
}
