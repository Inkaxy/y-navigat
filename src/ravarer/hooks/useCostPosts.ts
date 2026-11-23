// Kostnadsposter (PENDING `1-kjor-na/02_kostnadsposter.sql`, `rm_cap_kostnadsposter_v1`). Lesing og skriving bare via
// funksjonene i filen; svarene leses strengt i `lib/kostnadsposter/parse.ts`. Ukjent utfall sendes aldri automatisk på nytt.
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCompany } from "@/hooks/useCompany";
import { callPendingRpc, pendingSelect, useCapability, type PendingResult } from "@/lib/pendingRpc";
import {
  COST_POST_CODE, parseCostLines, parseCostSummary, parsePostOptions, parseSavePost, parseSetRule,
  type CostLines, type CostPostOption, type CostSummary,
} from "@/ravarer/lib/kostnadsposter/parse";

const KEY = ["ravarer", "kostnadsposter"] as const;

function unwrap<T>(r: PendingResult, parse: (v: unknown) => T | null): T {
  if (r.kind === "missing") throw new Error("Kostnadsposter venter på databaseendringen.");
  if (r.kind === "denied") throw new Error("Du har ikke tilgang til fakturaer.");
  if (r.kind === "error") throw new Error("Kunne ikke hente kostnadspostene.");
  const v = parse(r.data);
  if (v == null) throw new Error("Svaret fra databasen kunne ikke leses.");
  return v;
}

export function useCostPostsAvailable(): boolean | null {
  return useCapability("rm_cap_kostnadsposter_v1");
}

export function useCostSummary(year: number) {
  const { data: company } = useCompany();
  const cap = useCostPostsAvailable();
  return useQuery<CostSummary>({
    queryKey: [...KEY, "summary", company?.id, year],
    enabled: !!company && cap === true,
    staleTime: 60_000,
    queryFn: async ({ signal }) => unwrap(await callPendingRpc("rm_cost_post_summary", { p_legal_entity_id: company!.id, p_year: year }, signal), parseCostSummary),
  });
}

export function useCostLines(postId: string | null, year: number, supplierId: string | null) {
  const { data: company } = useCompany();
  const cap = useCostPostsAvailable();
  return useQuery<CostLines>({
    queryKey: [...KEY, "lines", company?.id, postId, year, supplierId],
    enabled: !!company && cap === true && !!postId,
    staleTime: 60_000,
    queryFn: async ({ signal }) => unwrap(await callPendingRpc("rm_cost_post_lines",
      { p_legal_entity_id: company!.id, p_cost_post_id: postId, p_year: year, p_supplier_id: supplierId }, signal), parseCostLines),
  });
}

/** Aktive poster (valglisten i Nye varer og forslagene). */
export function useCostPostOptions(enabled = true) {
  const { data: company } = useCompany();
  const cap = useCostPostsAvailable();
  return useQuery<CostPostOption[]>({
    queryKey: [...KEY, "options", company?.id],
    enabled: enabled && !!company && cap === true,
    staleTime: 60_000,
    queryFn: async ({ signal }) => unwrap(await pendingSelect("rm_cost_posts",
      `select=id,name&legal_entity_id=eq.${company!.id}&archived_at=is.null&order=name.asc&limit=500`, signal), parsePostOptions),
  });
}

export function invalidateCostPosts(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: KEY });
}

/** Skriving. Kaster norsk tekst; avvisning fra serveren er sikker (ingenting lagret), alt annet er ukjent utfall. */
export function useCostPostWrites() {
  const qc = useQueryClient();
  const { data: company } = useCompany();

  const fail = (r: PendingResult): never => {
    if (r.kind === "missing") throw new Error("Kostnadsposter venter på databaseendringen.");
    if (r.kind === "denied") throw new Error("Du har ikke skrivetilgang til fakturaer.");
    throw new Error("Utfallet er ukjent. Last siden på nytt og se om endringen er lagret før du prøver igjen.");
  };

  /** Opprett (id null), gi nytt navn eller arkiver. Gir postens id og navn. */
  const savePost = async (i: { id: string | null; name: string; archived?: boolean }): Promise<{ id: string; name: string }> => {
    if (!company) throw new Error("Selskapet er ikke lastet ennå.");
    const r = await callPendingRpc("rm_save_cost_post", { p_legal_entity_id: company.id, p_id: i.id, p_name: i.name, p_archived: i.archived ?? false });
    invalidateCostPosts(qc);
    if (r.kind !== "ok") return fail(r);
    const p = parseSavePost(r.data);
    if (!p) return fail({ kind: "error", status: 200, code: "uleselig" });
    if (!p.ok) throw new Error(COST_POST_CODE[p.code] ?? COST_POST_CODE.ugyldig);
    return { id: p.id, name: p.name };
  };

  /** Legg leverandørlinjen i posten (eller ta den ut med null). Gjelder alle fakturaer, også nye. */
  const setRule = async (i: { supplierId: string; itemKey: string; postId: string | null }): Promise<void> => {
    if (!company) throw new Error("Selskapet er ikke lastet ennå.");
    const r = await callPendingRpc("rm_set_cost_post_rule", { p_legal_entity_id: company.id, p_supplier_id: i.supplierId, p_item_key: i.itemKey, p_cost_post_id: i.postId });
    invalidateCostPosts(qc);
    if (r.kind !== "ok") return fail(r);
    const p = parseSetRule(r.data);
    if (!p) return fail({ kind: "error", status: 200, code: "uleselig" });
    if (!p.ok) throw new Error(COST_POST_CODE[p.code] ?? COST_POST_CODE.ugyldig);
  };

  return { savePost, setRule };
}
