import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { useRematchStatus } from "@/fakturaer/hooks/useRematchStatus";
import { parseRematchQueued } from "@/fakturaer/lib/parseRpcJson";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { paths } from "@/ravarer/lib/paths";

/** «Verktøy» i Priskontroll: omberegning (samme som innstillingene), reberegning og gammel visning. */
export function PriskontrollToolsMenu() {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const legalEntityId = company?.id ?? null;
  const status = useRematchStatus(legalEntityId);
  const busy = !!status.data && status.data.queued + status.data.in_flight > 0;

  const rematch = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("rm_rematch_invoices", { p_legal_entity_id: legalEntityId!, p_limit: 500, p_only_open: true });
      if (error) throw new Error("Kunne ikke starte ny beregning. Prøv igjen.");
      return parseRematchQueued(data).queued;
    },
    onSuccess: (n) => {
      invalidateRavarerCounts(qc);
      void qc.invalidateQueries({ queryKey: ["rematch-status"] });
      toast.success(n > 0 ? `${n} fakturaer er lagt i kø — oppdateres om litt` : "Ingen åpne fakturaer måtte beregnes på nytt");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Kunne ikke starte ny beregning."),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Wrench className="h-3.5 w-3.5" aria-hidden />Verktøy<ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[260px]">
        <DropdownMenuItem disabled={busy || rematch.isPending || !legalEntityId} onSelect={() => rematch.mutate()}>
          {busy ? "Omberegning pågår…" : "Beregn alle åpne på nytt"}
        </DropdownMenuItem>
        {status.data && (
          <DropdownMenuLabel className="text-caption font-normal text-muted-foreground tabular-nums">
            {status.data.queued} i kø · {status.data.in_flight} under arbeid · {status.data.failed_last_day} feilet siste døgn
          </DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link to={paths.reberegn()}>Reberegn kostpriser</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to={paths.beslutninger()}>Beslutninger per gruppe (gammel visning)</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
