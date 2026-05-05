import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const STORAGE_KEY = "kunder_selected_legal_entity";
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
  const [selected, setSelectedState] = useState<string | null>(() => {
    return typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  });

  // Initialiser fra default hvis ingen verdi i localStorage
  useEffect(() => {
    if (!selected && defaultEntityId) {
      setSelectedState(defaultEntityId);
      localStorage.setItem(STORAGE_KEY, defaultEntityId);
    }
  }, [defaultEntityId, selected]);

  const setSelected = useCallback(
    (id: string) => {
      setSelectedState(id);
      localStorage.setItem(STORAGE_KEY, id);
      // Invalider all kunde-data ved selskap-bytte
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer"] });
      queryClient.invalidateQueries({ queryKey: ["price-lists"] });
    },
    [queryClient],
  );

  const value = useMemo<Ctx>(
    () => ({ selected, setSelected, isAll: selected === ALL_ENTITIES }),
    [selected, setSelected],
  );

  return <SelectedEntityContext.Provider value={value}>{children}</SelectedEntityContext.Provider>;
}

export function useSelectedEntity() {
  const ctx = useContext(SelectedEntityContext);
  if (!ctx) throw new Error("useSelectedEntity must be used within SelectedEntityProvider");
  return ctx;
}
