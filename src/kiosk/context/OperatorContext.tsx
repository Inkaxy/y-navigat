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
  autoOperatorId,
  children,
}: {
  terminalId: string;
  autoOperatorId?: string | null;
  children: ReactNode;
}) {
  const storageKey = operatorStorageKey(terminalId);
  const [operator, setOperator] = useState<Operator | null>(null);

  // Hydrate from localStorage on mount (only when no auto-operator).
  // Kassasystemforskrifta: operatøren i localStorage er klientdata og kan være
  // manipulert eller utdatert — vi RE-VALIDERER mot serveren før vi lar
  // vedkommende betjene kassa.
  useEffect(() => {
    if (autoOperatorId) return;
    const stored = readJSON<Operator>(storageKey);
    if (!stored?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await kioskSupabase
        .from("pos_operators")
        .select("id, operator_code, display_name, legal_entity_id, status")
        .eq("id", stored.id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data || data.status !== "active") {
        clearKey(storageKey);
        setOperator(null);
        return;
      }
      const { data: terms } = await kioskSupabase
        .from("pos_operator_terminals")
        .select("terminal_id")
        .eq("operator_id", stored.id);
      const list = terms ?? [];
      if (list.length > 0 && !list.some((t) => t.terminal_id === terminalId)) {
        clearKey(storageKey);
        setOperator(null);
        return;
      }
      setOperator({
        id: data.id,
        code: data.operator_code,
        display_name: data.display_name ?? data.operator_code,
        legal_entity_id: data.legal_entity_id,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey, autoOperatorId, terminalId]);

  // Self-service: auto-load configured operator (no PIN)
  useEffect(() => {
    if (!autoOperatorId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await kioskSupabase
        .from("pos_operators")
        .select("id, operator_code, display_name, legal_entity_id, status")
        .eq("id", autoOperatorId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data || data.status !== "active") {
        setOperator(null);
        return;
      }
      setOperator({
        id: data.id,
        code: data.operator_code,
        display_name: data.display_name ?? data.operator_code,
        legal_entity_id: data.legal_entity_id,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [autoOperatorId]);

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
      // Journalfør innlogging — operatørbytte skal kunne spores i journalen.
      kioskSupabase
        .rpc("pos_journal_append", {
          p_terminal_id: terminalId,
          p_event_type: "operator_login",
          p_operator_id: op.id,
          p_payload: { operator_code: op.code },
        } as never)
        .then(({ error: jErr }) => {
          if (jErr) console.warn("pos_journal_append operator_login failed", jErr.message);
        });
      return { ok: true };
    },
    [terminalId, storageKey],
  );

  const logout = useCallback(() => {
    const opId = operator?.id ?? null;
    // Journalfør utlogging (fire-and-forget; må ikke blokkere UI).
    kioskSupabase
      .rpc("pos_journal_append", {
        p_terminal_id: terminalId,
        p_event_type: "operator_logout",
        p_operator_id: opId,
      } as never)
      .then(({ error }) => {
        if (error) console.warn("pos_journal_append operator_logout failed", error.message);
      });
    clearKey(storageKey);
    setOperator(null);
  }, [storageKey, terminalId, operator?.id]);

  return <Ctx.Provider value={{ operator, login, logout }}>{children}</Ctx.Provider>;
}

export function useOperator() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOperator must be used inside OperatorProvider");
  return v;
}
