/**
 * Fullstendig, deterministisk henting som ikke antar at en kort side betyr slutt.
 * Serveren kan ha en lavere radgrense enn forespurt sidestørrelse; derfor:
 * 1) eksakt antall for samme filter, 2) keyset på unik `id` stigende med faktisk siste ID,
 * 3) validering (unik, strengt stigende, aldri flere enn antallet), 4) antallet sjekkes på nytt.
 * Alt som ikke går opp kaster — aldri en delvis liste som om den var komplett.
 */
export class IncompleteFetchError extends Error {
  constructor(public readonly reason: "count" | "page" | "order" | "overflow" | "early_end" | "changed" | "aborted") {
    super(`Ufullstendig henting (${reason})`);
  }
}

type Res<T> = PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>;

export interface CountedFetchOpts<T extends { id: string }> {
  count: () => Res<unknown>;
  /** Side etter `afterId` (null = første), sortert på id stigende, med `.limit(pageSize)`. */
  page: (afterId: string | null, pageSize: number) => Res<T>;
  pageSize?: number;
  signal?: AbortSignal;
}

async function exactCount(fn: () => Res<unknown>): Promise<number> {
  const r = await fn();
  if (r.error || typeof r.count !== "number" || !Number.isInteger(r.count) || r.count < 0) throw new IncompleteFetchError("count");
  return r.count;
}

export async function fetchAllCounted<T extends { id: string }>(o: CountedFetchOpts<T>): Promise<T[]> {
  const size = o.pageSize ?? 500;
  const check = () => { if (o.signal?.aborted) throw new IncompleteFetchError("aborted"); };
  check();
  const expected = await exactCount(o.count);
  const out: T[] = [];
  let last: string | null = null;
  while (out.length < expected) {
    check();
    const r = await o.page(last, size);
    if (r.error || !Array.isArray(r.data)) throw new IncompleteFetchError("page");
    if (r.data.length === 0) throw new IncompleteFetchError("early_end");
    for (const row of r.data) {
      if (typeof row.id !== "string" || (last !== null && !(row.id > last))) throw new IncompleteFetchError("order");
      last = row.id;
      out.push(row);
    }
    if (out.length > expected) throw new IncompleteFetchError("overflow");
  }
  check();
  if ((await exactCount(o.count)) !== expected) throw new IncompleteFetchError("changed");
  return out;
}
