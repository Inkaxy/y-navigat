import { useEffect } from "react";
import { ChevronDown } from "lucide-react";
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
import { cn } from "@/lib/utils";

export function CompanySelector() {
  const { user } = useAuth();
  const { legalEntityId, setLegalEntityId } = useSelection();

  const { data: entities } = useQuery({
    queryKey: ["my-legal-entities", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // Hent kun selskaper brukeren har aktive stillinger i
      const { data: ids, error: idsErr } = await supabase.rpc("current_user_entity_ids");
      if (idsErr) throw idsErr;
      const entityIds = (ids ?? []) as unknown as string[];
      if (entityIds.length === 0) return [];

      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, short_code, legal_name, status, signature_color")
        .in("id", entityIds)
        .order("legal_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (legalEntityId || !entities?.length) return;
    const firstActive = entities.find((e) => e.status === "active") ?? entities[0];
    if (firstActive) setLegalEntityId(firstActive.id);
  }, [entities, legalEntityId, setLegalEntityId]);

  const active = entities?.find((e) => e.id === legalEntityId) ?? entities?.[0] ?? null;
  const initials = (active?.legal_name ?? "NB")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "group flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium",
          "text-app-foreground/95 transition-colors hover:bg-white/10 focus:outline-none",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md text-[11px] font-bold tracking-tight",
            "bg-app-dark text-app-foreground",
          )}
          aria-hidden
        >
          {initials || "NB"}
        </span>
        <span className="hidden max-w-[180px] truncate sm:inline">
          {active?.legal_name ?? "Velg selskap"}
        </span>
        <ChevronDown className="h-4 w-4 opacity-80" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Selskap</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {entities?.length ? (
          entities.map((e) => (
            <DropdownMenuItem
              key={e.id}
              onClick={() => setLegalEntityId(e.id)}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium">{e.legal_name}</span>
                <span className="text-xs text-muted-foreground">{e.short_code}</span>
              </span>
              {legalEntityId === e.id && (
                <span className="h-2 w-2 rounded-full bg-app" aria-hidden />
              )}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>Ingen selskaper</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
