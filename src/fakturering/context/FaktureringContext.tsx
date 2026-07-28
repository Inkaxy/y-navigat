import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSelection } from "@/providers/SelectionProvider";

const APP_CODE = "faktura";

export interface LegalEntity {
  id: string;
  legal_name: string;
  short_code: string;
  org_number: string;
}

interface FaktureringContextValue {
  activeEntityId: string | null;
  activeEntity: LegalEntity | null;
  availableEntities: LegalEntity[];
  setActiveEntity: (entityId: string) => void;
  isLoading: boolean;
  hasNoAccess: boolean;
  /** Global valgt enhet finnes ikke i faktura-tilgjengelige — vis picker i stedet for å endre kontekst stille. */
  needsEntitySelection: boolean;
}

const Ctx = createContext<FaktureringContextValue | undefined>(undefined);

async function fetchAvailableEntities(): Promise<LegalEntity[]> {
  const [posRes, accessRes] = await Promise.all([
    supabase.rpc("current_user_positions"),
    supabase.rpc("app_access_level", { p_app_code: APP_CODE }),
  ]);
  if (posRes.error) throw posRes.error;
  if (accessRes.error) throw accessRes.error;
  if (!accessRes.data || accessRes.data === "none") return [];

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

export function FaktureringProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { legalEntityId, setLegalEntityId } = useSelection();

  const { data: availableEntities = [], isLoading } = useQuery({
    queryKey: ["fakturering", "available-entities", user?.id],
    queryFn: fetchAvailableEntities,
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Sett bare første enhet som globalt valg dersom brukeren ikke har valgt noe
  // fra før. Vi bytter ALDRI en gyldig global enhet bare fordi den ikke er
  // faktura-tilgjengelig — det ville stille endret Ordre/Produksjon-konteksten
  // for brukeren. I stedet viser vi en enhetsvelger på faktura-sidene.
  useEffect(() => {
    if (isLoading) return;
    if (availableEntities.length === 0) return;
    if (!legalEntityId) setLegalEntityId(availableEntities[0].id);
  }, [availableEntities, isLoading, legalEntityId, setLegalEntityId]);

  const setActiveEntity = useCallback(
    (entityId: string) => setLegalEntityId(entityId),
    [setLegalEntityId],
  );

  const activeEntity = useMemo(
    () => availableEntities.find((e) => e.id === legalEntityId) ?? null,
    [availableEntities, legalEntityId],
  );

  const activeEntityId = activeEntity ? legalEntityId : null;

  const value: FaktureringContextValue = {
    activeEntityId,
    activeEntity,
    availableEntities,
    setActiveEntity,
    isLoading,
    hasNoAccess: !isLoading && availableEntities.length === 0,
    needsEntitySelection: !isLoading && availableEntities.length > 0 && !activeEntity,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFaktureringEntity() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFaktureringEntity must be used within FaktureringProvider");
  return ctx;
}
