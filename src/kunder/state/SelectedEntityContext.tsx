import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSelection } from "@/providers/SelectionProvider";

const LEGACY_STORAGE_KEY = "kunder_selected_legal_entity";
export const ALL_ENTITIES = "__ALL__";

type Ctx = {
  /** UUID, eller ALL_ENTITIES, eller null hvis ikke satt enda */
  selected: string | null;
  setSelected: (id: string) => void;
  isAll: boolean;
};

const SelectedEntityContext = createContext<Ctx | null>(null);

export function SelectedEntityProvider({
  children,
  defaultEntityId,
}: {
  children: React.ReactNode;
  defaultEntityId: string | null;
}) {
  const queryClient = useQueryClient();
  const { legalEntityId, setLegalEntityId } = useSelection();

  // Engangs-migrering fra gammel localStorage-nøkkel + initialisering fra default
  useEffect(() => {
    if (legalEntityId) return;
    if (typeof window === "undefined") return;
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      setLegalEntityId(legacy);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }
    if (defaultEntityId) {
      setLegalEntityId(defaultEntityId);
    }
  }, [legalEntityId, defaultEntityId, setLegalEntityId]);

  const setSelected = useCallback(
    (id: string) => {
      setLegalEntityId(id);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer"] });
      queryClient.invalidateQueries({ queryKey: ["price-lists"] });
    },
    [queryClient, setLegalEntityId],
  );

  const value = useMemo<Ctx>(
    () => ({
      selected: legalEntityId,
      setSelected,
      isAll: legalEntityId === ALL_ENTITIES,
    }),
    [legalEntityId, setSelected],
  );

  return <SelectedEntityContext.Provider value={value}>{children}</SelectedEntityContext.Provider>;
}

export function useSelectedEntity() {
  const ctx = useContext(SelectedEntityContext);
  if (!ctx) throw new Error("useSelectedEntity must be used within SelectedEntityProvider");
  return ctx;
}
