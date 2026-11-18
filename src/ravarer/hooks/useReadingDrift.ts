// Tall til helsesiden og stillstandsvarselet: siste ferdige lesing, lesekø og lesinger/feil siste døgn.
// Leses med vanlig fakturatilgang; ukjent (feil) er null, aldri 0.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import { errorsByType, readingStall, type StallState } from "@/ravarer/lib/drift/readingStall";

export interface ReadingDrift {
  lastOkAt: string | null; pending: number | null; attempts24h: number | null; failed24h: number | null;
  errors: { type: string; count: number }[] | null; stall: StallState;
}

export function useReadingDrift(enabled = true) {
  const { data: company } = useCompany();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: ["ravarer", "drift", "lesing", le],
    enabled: enabled && !!le,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<ReadingDrift> => {
      const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
      const [okR, pendR, attR, failR] = await Promise.all([
        supabase.from("invoices").select("line_extraction_at").eq("legal_entity_id", le!).eq("line_extraction_status", "done")
          .not("line_extraction_at", "is", null).order("line_extraction_at", { ascending: false }).limit(1),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("legal_entity_id", le!).eq("line_extraction_status", "pending"),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("legal_entity_id", le!)
          .in("line_extraction_status", ["done", "failed"]).gte("line_extraction_at", since),
        supabase.from("invoices").select("line_extraction_error").eq("legal_entity_id", le!).eq("line_extraction_status", "failed")
          .gte("line_extraction_at", since).limit(1000),
      ]);
      const lastOkAt = okR.error ? null : (okR.data?.[0]?.line_extraction_at ?? null);
      const pending = pendR.error ? null : (pendR.count ?? null);
      const attempts24h = attR.error ? null : (attR.count ?? null);
      const failed24h = failR.error ? null : (failR.data?.length ?? null);
      const errors = failR.error ? null : errorsByType(failR.data ?? []);
      return { lastOkAt: okR.error ? null : lastOkAt, pending, attempts24h, failed24h, errors,
        stall: okR.error ? { kind: "ukjent" } : readingStall({ lastOkAt, pending, attempts24h, failed24h }) };
    },
  });
}
