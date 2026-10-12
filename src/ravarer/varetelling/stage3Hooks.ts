import { useQuery } from "@tanstack/react-query";
import { useVtProbe, useVtScope } from "./hooks";
import { useStage3Api } from "./stage3";

export const s3Keys = {
  probe: (e: string) => ["vt", e, "s3", "probe"] as const,
  jobs: (e: string, list: string) => ["vt", e, "s3", "jobs", list] as const,
  props: (e: string, job: string) => ["vt", e, "s3", "props", job] as const,
  assignments: (e: string) => ["vt", e, "s3", "assign"] as const,
  units: (e: string) => ["vt", e, "s3", "units"] as const,
  preview: (e: string, count: string) => ["vt", e, "s3", "preview", count] as const,
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
