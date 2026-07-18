import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { differenceInHours } from "date-fns";
import { AlertTriangle, HeartPulse, ShieldCheck, XCircle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Kompakt Hjem-widget som viser røde signaler for kassasystemet:
 * brutte journalkjeder og terminaler som mangler Z-rapport.
 */
export function PosHealthWidget() {
  const { activeEntityId } = useLegalEntity();

  const { data: terminals = [] } = useQuery({
    queryKey: ["widget", "pos-helse", "terminals", activeEntityId],
    enabled: !!activeEntityId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_terminals")
        .select("id, terminal_code, display_name")
        .eq("legal_entity_id", activeEntityId!)
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
  });
  const terminalIds = terminals.map((t) => t.id);

  const { data: verifications = [] } = useQuery({
    queryKey: ["widget", "pos-helse", "verifications", terminalIds.join(",")],
    enabled: terminalIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_journal_verifications")
        .select("terminal_id, verified_at, is_valid")
        .in("terminal_id", terminalIds)
        .order("verified_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: zReports = [] } = useQuery({
    queryKey: ["widget", "pos-helse", "z-reports", terminalIds.join(",")],
    enabled: terminalIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_z_reports")
        .select("terminal_id, closed_at")
        .in("terminal_id", terminalIds)
        .order("closed_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { brokenChains, missingZ } = useMemo(() => {
    const now = new Date();
    const latestVer = new Map<string, { verified_at: string; is_valid: boolean }>();
    for (const v of verifications as any[]) {
      if (!latestVer.has(v.terminal_id)) latestVer.set(v.terminal_id, v);
    }
    const latestZ = new Map<string, string>();
    for (const z of zReports as any[]) {
      if (!latestZ.has(z.terminal_id)) latestZ.set(z.terminal_id, z.closed_at);
    }
    let broken = 0;
    let missing = 0;
    for (const t of terminals) {
      const v = latestVer.get(t.id);
      if (v && !v.is_valid) broken++;
      const z = latestZ.get(t.id);
      if (!z || differenceInHours(now, new Date(z)) > 48) missing++;
    }
    return { brokenChains: broken, missingZ: missing };
  }, [terminals, verifications, zReports]);

  const hasRed = brokenChains > 0 || missingZ > 0;

  return (
    <Card className={cn("overflow-hidden shadow-card", hasRed ? "border-red-500/40" : "border-line-subtle")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className={cn("h-5 w-5", hasRed ? "text-red-600" : "text-brand-bronze")} />
          Kasse-helse
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Link
          to="/pos-styring/helse"
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
            brokenChains > 0
              ? "border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300"
              : "bg-muted/30 hover:bg-muted/60",
          )}
        >
          {brokenChains > 0 ? <XCircle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          <span className="flex-1">Brutte journalkjeder</span>
          <span className="text-lg font-semibold tabular-nums">{brokenChains}</span>
        </Link>
        <Link
          to="/pos-styring/helse"
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
            missingZ > 0
              ? "border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300"
              : "bg-muted/30 hover:bg-muted/60",
          )}
        >
          <AlertTriangle className="h-4 w-4" />
          <span className="flex-1">Manglende Z-rapporter</span>
          <span className="text-lg font-semibold tabular-nums">{missingZ}</span>
        </Link>
        {!hasRed && terminals.length > 0 && (
          <p className="pt-1 text-xs text-muted-foreground">Alle terminaler er innenfor forskriftens frister.</p>
        )}
      </CardContent>
    </Card>
  );
}
