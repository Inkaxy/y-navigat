import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { kioskSupabase } from "@/kiosk/integrations/supabase/client";
import { clearKey, operatorStorageKey, readJSON, writeJSON } from "@/kiosk/lib/localStorage";

export interface Operator {
  id: string;
  code: string;
  display_name: string;
  legal_entity_id?: string | null;
}

export type LoginResult = { ok: boolean; error?: string };

interface State {
  operator: Operator | null;
  login: (code: string, pin: string) => Promise<LoginResult>;
  logout: () => void;
}

const Ctx = createContext<State | null>(null);

export function OperatorProvider({
  terminalId,
  children,
}: {
  terminalId: string;
  children: ReactNode;
}) {
  const storageKey = operatorStorageKey(terminalId);
  const [operator, setOperator] = useState<Operator | null>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = readJSON<Operator>(storageKey);
    if (stored) setOperator(stored);
  }, [storageKey]);

  const login = useCallback<State["login"]>(
    async (code, pin) => {
      const trimmedCode = code.trim().toUpperCase();
      const trimmedPin = pin.trim();
      if (!trimmedCode || !trimmedPin) {
        return { ok: false, error: "Operatør-kode og PIN må fylles ut." };
      }
      const { data, error } = await kioskSupabase.rpc("pos_operator_authenticate", {
        p_terminal_id: terminalId,
        p_operator_code: trimmedCode,
        p_pin: trimmedPin,
      } as never);
      if (error) {
        return { ok: false, error: error.message || "Kunne ikke logge inn operatør." };
      }
      // RPC kan returnere ett objekt eller en rad-array — håndter begge.
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { ok: false, error: "Ukjent operatør eller feil PIN." };
      const r = row as {
        operator_id: string | null;
        display_name: string | null;
        legal_entity_id: string | null;
        can_use_terminal: boolean | null;
      };
      if (!r.operator_id || !r.can_use_terminal) {
        return { ok: false, error: "Operatør har ikke tilgang til denne terminalen." };
      }
      const op: Operator = {
        id: r.operator_id,
        code: trimmedCode,
        display_name: r.display_name ?? trimmedCode,
        legal_entity_id: r.legal_entity_id,
      };
      writeJSON(storageKey, op);
      setOperator(op);
      return { ok: true };
    },
    [terminalId, storageKey],
  );

  const logout = useCallback(() => {
    clearKey(storageKey);
    setOperator(null);
  }, [storageKey]);

  return <Ctx.Provider value={{ operator, login, logout }}>{children}</Ctx.Provider>;
}

export function useOperator() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOperator must be used inside OperatorProvider");
  return v;
}
