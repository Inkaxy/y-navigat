import { useQuery } from "@tanstack/react-query";
import { useVtProbe, useVtScope } from "./hooks";
import { useStage3Api, type VtClarification } from "./stage3";
import type { VtCountLine } from "./types";

export const s3Keys = {
  probe: (e: string) => ["vt", e, "s3", "probe"] as const,
  jobs: (e: string, list: string) => ["vt", e, "s3", "jobs", list] as const,
  props: (e: string, job: string) => ["vt", e, "s3", "props", job] as const,
  assignments: (e: string) => ["vt", e, "s3", "assign"] as const,
  units: (e: string) => ["vt", e, "s3", "units"] as const,
  preview: (e: string, count: string) => ["vt", e, "s3", "preview", count] as const,
  clars: (e: string, count: string) => ["vt", e, "s3", "clars", count] as const,
  users: (e: string) => ["vt", e, "s3", "users"] as const,
};

/** «ok» bare når grunnlaget OG trinn 3 er rullet ut. */
export function useStage3Ready(): { ready: boolean; loading: boolean; missing: boolean } {
  const api = useStage3Api(); const { entity } = useVtScope(); const base = useVtProbe();
  const q = useQuery({ queryKey: s3Keys.probe(entity), queryFn: () => (api ? api.probe() : Promise.resolve("missing" as const)), enabled: !!entity && base.data === "ok", staleTime: 60_000, retry: 1 });
  return { ready: !!api && q.data === "ok", loading: q.isLoading, missing: !api || q.data === "missing" };
}
export function useS3Read<T>(key: readonly unknown[], fn: () => Promise<T>, enabled = true) {
  const { ready } = useStage3Ready();
  return useQuery({ queryKey: key, queryFn: fn, enabled: ready && enabled });
}

/**
 * Fletter gjeldende prisavklaringer inn i linjene (clar_*). Skjerm, nedlasting og e-post bruker da samme
 * verdsettelse som avslutningsregelen. Uten trinn 3 eller ved feil: linjene uendret + feilen synlig.
 */
export function useClarifiedLines(countId: string, lines: VtCountLine[]): { lines: VtCountLine[]; clarifications: VtClarification[]; error: boolean; loading: boolean } {
  const api = useStage3Api(); const { entity } = useVtScope();
  const q = useS3Read(s3Keys.clars(entity, countId), () => (api ? api.listClarifications(entity, countId) : Promise.resolve([])));
  const all = q.data ?? [];
  const active = new Map(all.filter(c => c.superseded_at == null).map(c => [c.line_id, c]));
  const merged = lines.map(l => {
    const c = l.snap_price_per_base == null ? active.get(l.id) : undefined;
    return c ? { ...l, clar_price_per_base: c.price_per_base, clar_source_kind: c.source_kind, clar_source_ref: c.source_ref, clar_reason: c.reason,
      clar_at: new Date(c.decided_at).toLocaleString("nb-NO", { timeZone: "Europe/Oslo" }) } : l;
  });
  return { lines: merged, clarifications: all, error: !!q.error, loading: q.isLoading };
}
