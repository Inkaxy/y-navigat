import { createContext, useContext, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVtApi } from "./api";
import type { EntryPart, LineState, SaveLineResult, VtCountLine } from "./types";

export interface VtScope { entity: string; canWrite: boolean; canApprove: boolean }
export const VtScopeContext = createContext<VtScope | null>(null);
export function useVtScope(): VtScope {
  const s = useContext(VtScopeContext);
  if (!s) throw new Error("VtScopeContext mangler");
  return s;
}

export const vtKeys = {
  all: (e: string) => ["vt", e] as const,
  probe: (e: string) => ["vt", e, "probe"] as const,
  locations: (e: string) => ["vt", e, "locations"] as const,
  templates: (e: string) => ["vt", e, "templates"] as const,
  tlines: (e: string) => ["vt", e, "tlines"] as const,
  materials: (e: string) => ["vt", e, "materials"] as const,
  counts: (e: string) => ["vt", e, "counts"] as const,
  count: (e: string, id: string) => ["vt", e, "count", id] as const,
  coverage: (e: string, ids: string[]) => ["vt", e, "coverage", [...ids].sort().join(",")] as const,
};

export function useVtProbe() {
  const api = useVtApi(); const { entity } = useVtScope();
  return useQuery({ queryKey: vtKeys.probe(entity), queryFn: () => api.probe(entity), enabled: !!entity, staleTime: 60_000, retry: 1 });
}
function useVtRead<T>(key: readonly unknown[], fn: () => Promise<T>, enabled = true) {
  const { entity } = useVtScope();
  const probe = useVtProbe();
  return useQuery({ queryKey: key, queryFn: fn, enabled: !!entity && probe.data === true && enabled });
}
export function useVtLocations() { const api = useVtApi(); const { entity } = useVtScope(); return useVtRead(vtKeys.locations(entity), () => api.listLocations(entity)); }
export function useVtTemplates() { const api = useVtApi(); const { entity } = useVtScope(); return useVtRead(vtKeys.templates(entity), () => api.listTemplates(entity)); }
export function useVtTemplateLines() { const api = useVtApi(); const { entity } = useVtScope(); return useVtRead(vtKeys.tlines(entity), () => api.listTemplateLines(entity)); }
export function useVtMaterials() { const api = useVtApi(); const { entity } = useVtScope(); return useVtRead(vtKeys.materials(entity), () => api.listMaterials(entity)); }
export function useVtCounts() { const api = useVtApi(); const { entity } = useVtScope(); return useVtRead(vtKeys.counts(entity), () => api.listCounts(entity)); }
export function useVtCount(id: string | null) {
  const api = useVtApi(); const { entity } = useVtScope();
  return useVtRead(vtKeys.count(entity, id ?? ""), () => api.getCount(entity, id ?? ""), !!id);
}
export function useVtCoverage(ids: string[]) {
  const api = useVtApi(); const { entity } = useVtScope();
  return useVtRead(vtKeys.coverage(entity, ids), () => api.checkCoverage(entity, ids), ids.length > 0);
}

/** Enkel skrivemutasjon som invaliderer alt i tellesystemet for firmaet. */
export function useVtMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient(); const { entity } = useVtScope();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: vtKeys.all(entity) }) });
}

export type LineSaveStatus = { kind: "lagrer" } | { kind: "lagret" } | { kind: "ukjent"; message: string } | { kind: "avvist"; message: string } | { kind: "konflikt"; current: VtCountLine };
export interface LineDraft { state: LineState; countedBase: number | null; entry: EntryPart[]; note: string | null }

/**
 * Lagrer én linje med CAS. Hver linje har én ventende operasjon med frosset innhold og op-id:
 * ukjent utfall sendes uendret på nytt (samme op-id); ny op-id først etter kjent utfall.
 */
export function useLineSaver(countId: string) {
  const api = useVtApi(); const qc = useQueryClient(); const { entity } = useVtScope();
  const pending = useRef(new Map<string, { opId: string; draft: LineDraft; expectedRevision: number }>());
  const busy = useRef(new Set<string>());
  return async function save(line: VtCountLine, draft: LineDraft | null): Promise<{ status: LineSaveStatus; result?: SaveLineResult }> {
    if (busy.current.has(line.id)) return { status: { kind: "lagrer" } };
    let op = pending.current.get(line.id);
    if (!op) {
      if (!draft) return { status: { kind: "avvist", message: "Ingenting å lagre." } };
      op = { opId: crypto.randomUUID(), draft, expectedRevision: line.revision };
      pending.current.set(line.id, op);
    }
    busy.current.add(line.id);
    try {
      const result = await api.saveLine({ opId: op.opId, lineId: line.id, expectedRevision: op.expectedRevision, ...op.draft });
      pending.current.delete(line.id);
      qc.setQueryData(vtKeys.count(entity, countId), (old: { lines: VtCountLine[] } & Record<string, unknown> | undefined) => {
        if (!old) return old;
        const fresh = result.kind === "saved" ? result.line : result.current;
        return { ...old, lines: old.lines.map(l => (l.id === fresh.id && fresh.revision >= l.revision ? fresh : l)) };
      });
      return result.kind === "saved" ? { status: { kind: "lagret" }, result } : { status: { kind: "konflikt", current: result.current }, result };
    } catch (e) {
      const name = e instanceof Error ? e.constructor.name : "";
      if (name === "VtRejectedError" || name === "VtBackendUnavailableError") {
        pending.current.delete(line.id);
        return { status: { kind: "avvist", message: e instanceof Error ? e.message : "Avvist." } };
      }
      return { status: { kind: "ukjent", message: e instanceof Error ? e.message : "Ukjent utfall." } };
    } finally {
      busy.current.delete(line.id);
    }
  };
}
export function hasPendingOp(saver: unknown): boolean { return saver != null; }
