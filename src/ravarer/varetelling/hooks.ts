import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVtApi, VtBackendUnavailableError, VtRejectedError, VtUnknownOutcomeError } from "./api";
import { pendingStoreFor, type PendingOp, type PendingStore } from "./pendingStore";
import type { EntryInput, LineState, SaveLineResult, ValuationMode, VtCountLine } from "./types";

export interface VtScope { entity: string; userId: string | null; canWrite: boolean; canApprove: boolean }
export const VtScopeContext = createContext<VtScope | null>(null);
export function useVtScope(): VtScope {
  const s = useContext(VtScopeContext);
  if (!s) throw new Error("VtScopeContext mangler");
  return s;
}
/** Alltid gjeldende omfang (for kontroll rett før hver skriving). */
function useScopeRef(): { current: VtScope } {
  const s = useVtScope(); const ref = useRef(s); ref.current = s; return ref;
}

export const vtKeys = {
  all: (e: string) => ["vt", e] as const,
  probe: (e: string) => ["vt", e, "probe"] as const,
  locations: (e: string) => ["vt", e, "locations"] as const,
  templates: (e: string) => ["vt", e, "templates"] as const,
  tlines: (e: string) => ["vt", e, "tlines"] as const,
  materials: (e: string) => ["vt", e, "materials"] as const,
  departments: (e: string) => ["vt", e, "departments"] as const,
  counts: (e: string) => ["vt", e, "counts"] as const,
  count: (e: string, id: string) => ["vt", e, "count", id] as const,
  coverage: (e: string, ids: string[], mode: ValuationMode, date: string | null) => ["vt", e, "coverage", [...ids].sort().join(","), mode, date] as const,
};

export function useVtProbe() {
  const api = useVtApi(); const { entity } = useVtScope();
  return useQuery({ queryKey: vtKeys.probe(entity), queryFn: () => api.probe(entity), enabled: !!entity, staleTime: 60_000, retry: 1 });
}
function useVtRead<T>(key: readonly unknown[], fn: () => Promise<T>, enabled = true) {
  const { entity } = useVtScope();
  const probe = useVtProbe();
  return useQuery({ queryKey: key, queryFn: fn, enabled: !!entity && probe.data === "ok" && enabled });
}
export function useVtLocations() { const api = useVtApi(); const { entity } = useVtScope(); return useVtRead(vtKeys.locations(entity), () => api.listLocations(entity)); }
export function useVtTemplates() { const api = useVtApi(); const { entity } = useVtScope(); return useVtRead(vtKeys.templates(entity), () => api.listTemplates(entity)); }
export function useVtTemplateLines() { const api = useVtApi(); const { entity } = useVtScope(); return useVtRead(vtKeys.tlines(entity), () => api.listTemplateLines(entity)); }
export function useVtMaterials() { const api = useVtApi(); const { entity } = useVtScope(); return useVtRead(vtKeys.materials(entity), () => api.listMaterials(entity)); }
export function useVtDepartments() { const api = useVtApi(); const { entity } = useVtScope(); return useVtRead(vtKeys.departments(entity), () => api.listDepartments(entity)); }
export function useVtCounts() { const api = useVtApi(); const { entity } = useVtScope(); return useVtRead(vtKeys.counts(entity), () => api.listCounts(entity)); }
export function useVtCount(id: string | null) {
  const api = useVtApi(); const { entity } = useVtScope();
  return useVtRead(vtKeys.count(entity, id ?? ""), () => api.getCount(entity, id ?? ""), !!id);
}
export function useVtCoverage(ids: string[], mode: ValuationMode, date: string | null) {
  const api = useVtApi(); const { entity } = useVtScope();
  const valid = ids.length > 0 && (mode === "ved_start" || !!date);
  return useVtRead(vtKeys.coverage(entity, ids, mode, date), () => api.checkCoverage(entity, ids, mode, date), valid);
}

// ---------------- Ventende operasjoner ----------------
export function usePendingStore(): PendingStore {
  const { userId, entity } = useVtScope();
  return pendingStoreFor(userId, entity);
}
export function usePendingOp(key: string): { op: PendingOp | undefined; locked: boolean } {
  const store = usePendingStore();
  useSyncExternalStore(useCallback(fn => store.subscribe(fn), [store]), () => store.getVersion());
  return { op: store.get(key), locked: store.isLocked(key) };
}

export type OpOutcome<O> = { kind: "ok"; value: O } | { kind: "rejected"; message: string } | { kind: "unknown"; message: string } | { kind: "busy" };

/**
 * Skrivehandling med frosset op-id: reserveres før kallet, beholdes ved ukjent utfall
 * (også etter avmontering/omlasting), og bare samme innhold kan sendes på nytt med samme op-id.
 * Firma og rettighet kontrolleres rett før kallet.
 */
export function useOpAction<P, O>(key: string, need: "write" | "approve", run: (opId: string, payload: P) => Promise<O>) {
  const store = usePendingStore(); const scope = useScopeRef(); const qc = useQueryClient();
  const captured = useRef(scope.current.entity);
  const state = usePendingOp(key);
  const execute = useCallback(async (payload: P, sig: string): Promise<OpOutcome<O>> => {
    const s = scope.current;
    if (s.entity !== captured.current || (need === "write" ? !s.canWrite : !s.canApprove)) return { kind: "rejected", message: "Du mangler tilgang til denne handlingen nå." };
    if (!store.tryLock(key)) return { kind: "busy" };
    let op = store.get(key) as PendingOp<P> | undefined;
    try {
      if (op && op.sig !== sig) return { kind: "rejected", message: "En tidligere sending har ukjent utfall. Send den på nytt eller kontroller før du gjør noe annet." };
      if (!op) { op = { key, opId: crypto.randomUUID(), sig, payload, state: "inflight", at: new Date().toISOString() }; store.put(op); }
      else store.mark(key, op.opId, "inflight");
      const value = await run(op.opId, op.payload);
      store.remove(key, op.opId);
      return { kind: "ok", value };
    } catch (e) {
      if (op && (e instanceof VtRejectedError || e instanceof VtBackendUnavailableError)) { store.remove(key, op.opId); return { kind: "rejected", message: e.message }; }
      if (op) store.mark(key, op.opId, "unknown");
      return { kind: "unknown", message: e instanceof VtUnknownOutcomeError ? e.message : new VtUnknownOutcomeError().message };
    } finally {
      store.unlock(key);
      void qc.invalidateQueries({ queryKey: vtKeys.all(captured.current) });
    }
  }, [store, key, need, run, scope, qc]);
  return { execute, pending: state.op, busy: state.locked };
}

/** Lesemutasjon uten op-id (brukes ikke for skriving). */
export function useVtInvalidate() {
  const qc = useQueryClient(); const { entity } = useVtScope();
  return () => qc.invalidateQueries({ queryKey: vtKeys.all(entity) });
}
export { useMutation };

// ---------------- Linjelagring ----------------
export type LineSaveStatus =
  | { kind: "lagrer" } | { kind: "lagret" } | { kind: "ukjent"; message: string }
  | { kind: "avvist"; message: string } | { kind: "konflikt"; current: VtCountLine };
export interface LineDraft { state: LineState; countedBase: number | null; entry: EntryInput[]; note: string | null }
export interface LinePayload { lineId: string; countId: string; expectedRevision: number; draft: LineDraft }
export const lineKey = (lineId: string) => `line:${lineId}`;

/**
 * Lagrer én linje med CAS mot redigeringens grunnrevisjon (ikke nyeste props).
 * Ventende innslag ligger i felles butikk per bruker+firma og overlever avmontering/omlasting.
 */
export function useLineSaver(countId: string) {
  const api = useVtApi(); const qc = useQueryClient(); const store = usePendingStore(); const scope = useScopeRef();
  const captured = useRef(scope.current.entity);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useCallback(async (payload: LinePayload | null, lineId: string): Promise<LineSaveStatus> => {
    const s = scope.current;
    if (s.entity !== captured.current || !s.canWrite) return { kind: "avvist", message: "Du mangler skrivetilgang nå." };
    const key = lineKey(lineId);
    if (!store.tryLock(key)) return { kind: "lagrer" };
    const existing = store.get(key) as PendingOp<LinePayload> | undefined;
    let op: PendingOp<LinePayload>;
    try {
      if (existing) {
        if (payload && JSON.stringify(payload) !== existing.sig) return { kind: "avvist", message: "En tidligere lagring har ukjent utfall. Send den på nytt først." };
        op = existing; store.mark(key, op.opId, "inflight");
      } else {
        if (!payload) return { kind: "avvist", message: "Ingenting å lagre." };
        op = { key, opId: crypto.randomUUID(), sig: JSON.stringify(payload), payload, state: "inflight", at: new Date().toISOString() };
        store.put(op);
      }
      let result: SaveLineResult;
      try {
        result = await api.saveLine({ opId: op.opId, lineId, expectedRevision: op.payload.expectedRevision, ...op.payload.draft });
      } catch (e) {
        if (e instanceof VtRejectedError || e instanceof VtBackendUnavailableError) { store.remove(key, op.opId); return { kind: "avvist", message: e.message }; }
        store.mark(key, op.opId, "unknown");
        return { kind: "ukjent", message: new VtUnknownOutcomeError().message };
      }
      store.remove(key, op.opId);
      const fresh = result.kind === "saved" ? result.line : result.current;
      qc.setQueryData(vtKeys.count(captured.current, countId), (old: { lines: VtCountLine[] } & Record<string, unknown> | undefined) => {
        if (!old) return old;
        return { ...old, lines: old.lines.map(l => (l.id === fresh.id && fresh.revision >= l.revision ? fresh : l)) };
      });
      if (!mounted.current) void qc.invalidateQueries({ queryKey: vtKeys.count(captured.current, countId) });
      return result.kind === "saved" ? { kind: "lagret" } : { kind: "konflikt", current: result.current };
    } finally {
      store.unlock(key);
    }
  }, [api, qc, store, scope, countId]);
}
