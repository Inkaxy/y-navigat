import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface Selection {
  legalEntityId: string | null;
  outletId: string | null;
}

interface SelectionContextValue extends Selection {
  setLegalEntityId: (id: string | null) => void;
  setOutletId: (id: string | null) => void;
}

const STORAGE_KEY = "nbhub.selection";

const SelectionContext = createContext<SelectionContextValue | undefined>(undefined);

function readInitial(): Selection {
  if (typeof window === "undefined") return { legalEntityId: null, outletId: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { legalEntityId: null, outletId: null };
    const parsed = JSON.parse(raw);
    return {
      legalEntityId: typeof parsed.legalEntityId === "string" ? parsed.legalEntityId : null,
      outletId: typeof parsed.outletId === "string" ? parsed.outletId : null,
    };
  } catch {
    return { legalEntityId: null, outletId: null };
  }
}

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Selection>(readInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const value: SelectionContextValue = {
    ...state,
    setLegalEntityId: (id) => setState((s) => ({ ...s, legalEntityId: id, outletId: null })),
    setOutletId: (id) => setState((s) => ({ ...s, outletId: id })),
  };

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection() {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used within SelectionProvider");
  return ctx;
}
