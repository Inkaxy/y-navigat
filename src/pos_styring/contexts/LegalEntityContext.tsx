import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSelection } from "@/providers/SelectionProvider";

/**
 * NBhub-adapter for POS Styring's `useLegalEntity()`-kontrakt.
 * Beholder original API som de importerte POS-sidene forventer, men
 * bruker NBhubs GLOBALE `useSelection()` som single source of truth for
 * aktiv legal_entity. `setActiveEntity()` skriver til samme globale state,
 * slik at topbar (CompanyBlock) og POS-sidene alltid er synkronisert.
 */

const APP_CODE = "pos_styring";

export interface LegalEntity {
  id: string;
  legal_name: string;
  short_code: string;
  org_number: string;
}

interface LegalEntityContextValue {
  activeEntityId: string | null;
  activeEntity: LegalEntity | null;
  availableEntities: LegalEntity[];
  setActiveEntity: (entityId: string) => void;
  isLoading: boolean;
  hasNoAccess: boolean;
}

const LegalEntityContext = createContext<LegalEntityContextValue | undefined>(undefined);

async function fetchAvailableEntities(): Promise<LegalEntity[]> {
  const [posRes, accessRes] = await Promise.all([
    supabase.rpc("current_user_positions"),
    supabase.rpc("has_app_write_access", { p_app_code: APP_CODE }),
  ]);
  if (posRes.error) throw posRes.error;
  if (accessRes.error) throw accessRes.error;
  if (!accessRes.data) return [];

  const positions = (posRes.data ?? []) as Array<{ legal_entity_id: string }>;
  const entityIds = Array.from(new Set(positions.map((p) => p.legal_entity_id).filter(Boolean)));
  if (entityIds.length === 0) return [];

  const { data, error } = await supabase
    .from("legal_entities")
    .select("id, legal_name, short_code, org_number")
    .in("id", entityIds)
    .eq("status", "active")
    .order("short_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LegalEntity[];
}

export function LegalEntityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { legalEntityId, setLegalEntityId } = useSelection();

  const { data: availableEntities = [], isLoading } = useQuery({
    queryKey: ["pos-styring", "available-entities", user?.id],
    queryFn: fetchAvailableEntities,
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Init: hvis ingenting valgt globalt, sett første tilgjengelige POS-entity.
  useEffect(() => {
    if (isLoading) return;
    if (availableEntities.length === 0) return;
    const stillValid = legalEntityId && availableEntities.some((e) => e.id === legalEntityId);
    if (!stillValid) {
      setLegalEntityId(availableEntities[0].id);
    }
  }, [availableEntities, isLoading, legalEntityId, setLegalEntityId]);

  const setActiveEntity = useCallback(
    (entityId: string) => {
      setLegalEntityId(entityId);
    },
    [setLegalEntityId],
  );

  const activeEntity = useMemo(
    () => availableEntities.find((e) => e.id === legalEntityId) ?? null,
    [availableEntities, legalEntityId],
  );

  const value: LegalEntityContextValue = {
    activeEntityId: legalEntityId,
    activeEntity,
    availableEntities,
    setActiveEntity,
    isLoading,
    hasNoAccess: !isLoading && availableEntities.length === 0,
  };

  return <LegalEntityContext.Provider value={value}>{children}</LegalEntityContext.Provider>;
}

export function useLegalEntity() {
  const ctx = useContext(LegalEntityContext);
  if (!ctx) throw new Error("useLegalEntity must be used within LegalEntityProvider");
  return ctx;
}
