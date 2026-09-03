import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useCompany } from "@/hooks/useCompany";

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

/**
 * NBhub er ett firma: sørger for at lagret `legalEntityId` alltid peker på den
 * ene aktive raden i `legal_entities` (også når lagret id er slettet).
 */
function CompanySync({
  legalEntityId,
  setLegalEntityId,
}: {
  legalEntityId: string | null;
  setLegalEntityId: (id: string | null) => void;
}) {
  const { data: company } = useCompany();
  useEffect(() => {
    if (company && company.id !== legalEntityId) setLegalEntityId(company.id);
  }, [company, legalEntityId, setLegalEntityId]);
  return null;
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
    setLegalEntityId: (id) =>
      setState((s) => (s.legalEntityId === id ? s : { ...s, legalEntityId: id, outletId: null })),
    setOutletId: (id) => setState((s) => ({ ...s, outletId: id })),
  };

  return (
    <SelectionContext.Provider value={value}>
      <CompanySync legalEntityId={state.legalEntityId} setLegalEntityId={value.setLegalEntityId} />
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection() {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used within SelectionProvider");
  return ctx;
}
