import { useEffect } from "react";
import { ChevronDown, Store } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useSelection } from "@/providers/SelectionProvider";
import { useAuth } from "@/hooks/useAuth";
import { useMyPositions } from "@/hooks/useMyPositions";
import { cn } from "@/lib/utils";

export function OutletSelector() {
  const { user } = useAuth();
  const { legalEntityId, outletId, setOutletId } = useSelection();
  const { data: positions } = useMyPositions();

  const { data: outlets } = useQuery({
    queryKey: ["my-outlets", user?.id, legalEntityId],
    enabled: !!user?.id && !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outlets")
        .select("id, short_name, full_name, display_number, status, legal_entity_id")
        .eq("legal_entity_id", legalEntityId!)
        .order("display_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Filtrer outlets basert på user_positions for valgt selskap
  const accessible = (() => {
    if (!outlets || !positions) return outlets ?? [];
    const entityPositions = (positions as any[]).filter(
      (p) => p.legal_entity?.id === legalEntityId,
    );
    if (entityPositions.length === 0) return [];
    const hasAll = entityPositions.some((p) => p.outlet_scope === "all");
    if (hasAll) return outlets;
    const allowedIds = new Set<string>(
      entityPositions.flatMap((p) => p.outlet_ids ?? []),
    );
    return outlets.filter((o) => allowedIds.has(o.id));
  })();

  useEffect(() => {
    if (!accessible?.length) return;
    const exists = accessible.some((o) => o.id === outletId);
    if (!exists) {
      const firstActive = accessible.find((o) => o.status === "active") ?? accessible[0];
      setOutletId(firstActive?.id ?? null);
    }
  }, [accessible, outletId, setOutletId]);

  const active = accessible?.find((o) => o.id === outletId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-2 rounded-md border border-white/25 bg-white/5 px-3 py-1.5 text-sm",
          "text-app-foreground transition-colors hover:bg-white/15 focus:outline-none",
        )}
      >
        <Store className="h-4 w-4 sm:hidden" />
        <span className="hidden max-w-[160px] truncate sm:inline">
          {active?.short_name ?? "Velg outlet"}
        </span>
        <ChevronDown className="h-4 w-4 opacity-80" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Outlet</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!legalEntityId && (
          <DropdownMenuItem disabled>Velg selskap først</DropdownMenuItem>
        )}
        {legalEntityId && (accessible?.length ?? 0) === 0 && (
          <DropdownMenuItem disabled>Ingen outlets</DropdownMenuItem>
        )}
        {accessible?.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onClick={() => setOutletId(o.id)}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium">{o.short_name}</span>
              <span className="text-xs text-muted-foreground">#{o.display_number}</span>
            </span>
            {outletId === o.id && (
              <span className="h-2 w-2 rounded-full bg-app" aria-hidden />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
