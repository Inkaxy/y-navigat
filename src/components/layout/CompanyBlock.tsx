import { ChevronDown, LayoutDashboard } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
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

interface Entity {
  id: string;
  legal_name: string;
  short_code: string;
  status: string;
  founded_year: number | null;
}

/** Strips trailing " AS" / " ASA" / " AB" and uppercases. */
function brandLabel(legalName: string): string {
  return legalName.replace(/\s+(AS|ASA|AB|SA|BV)\s*$/i, "").toUpperCase();
}

/**
 * CompanyBlock — venstre i topbar.
 * Bruker NBHubs `current_user_entity_ids` RPC (samme som CompanySelector i dag),
 * men presenteres med NBOS-mønsteret: "NØTTERØ BAKERI<sup>1898</sup> ▾".
 */
export function CompanyBlock({ className }: { className?: string }) {
  const { user } = useAuth();
  const { legalEntityId, setLegalEntityId } = useSelection();

  const { data: entities } = useQuery({
    queryKey: ["my-legal-entities", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: ids, error: idsErr } = await supabase.rpc("current_user_entity_ids");
      if (idsErr) throw idsErr;
      const entityIds = (ids ?? []) as unknown as string[];
      if (entityIds.length === 0) return [] as Entity[];

      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, short_code, legal_name, status, founded_year")
        .in("id", entityIds)
        .order("legal_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Entity[];
    },
  });

  useEffect(() => {
    if (legalEntityId || !entities?.length) return;
    const firstActive = entities.find((e) => e.status === "active") ?? entities[0];
    if (firstActive) setLegalEntityId(firstActive.id);
  }, [entities, legalEntityId, setLegalEntityId]);

  const active = entities?.find((e) => e.id === legalEntityId) ?? entities?.[0] ?? null;
  const label = active ? brandLabel(active.legal_name) : "VELG SELSKAP";
  const year = active?.founded_year ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "group flex items-center gap-1.5 py-1.5 pl-1 pr-3.5 text-app-foreground transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded",
          "border-r border-white/20",
          className,
        )}
      >
        <span
          className="font-display italic"
          style={{ fontWeight: 400, fontSize: "13px", letterSpacing: "0.05em" }}
        >
          {label}
          {year && (
            <sup
              className="font-display"
              style={{
                fontSize: "9px",
                fontWeight: 400,
                marginLeft: "2px",
                verticalAlign: "super",
                opacity: 0.7,
              }}
            >
              {year}
            </sup>
          )}
        </span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
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
              {legalEntityId === e.id && <span className="h-2 w-2 rounded-full bg-app" aria-hidden />}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>Ingen selskap funnet</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Re-eksport som ikon — kun for visuell bruk i BrandBlock. */
export const CompanyBlockIcon = LayoutDashboard;
