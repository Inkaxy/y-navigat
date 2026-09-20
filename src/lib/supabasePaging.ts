/**
 * Fetches ALL rows for a Supabase query by paging with .range() until a page
 * returns fewer rows than pageSize. Use this whenever a result feeds a sum,
 * total, aggregation or CSV export — never rely on a single .limit() call for
 * those, since it silently truncates large datasets.
 *
 * `buildQuery(from, to)` must apply `.range(from, to)` (and any other
 * filters/order) and return the query result, e.g.:
 *   fetchAllRows((from, to) => supabase.from("t").select("*").range(from, to))
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * Henter inntil `wanted` rader, side for side. Bruk denne når det finnes et
 * tak: et enkelt `.range(0, tak)` stopper på API-ets radgrense (1000) og ser
 * ut som om det ikke finnes flere rader.
 */
export async function fetchPagesUpTo<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  wanted: number,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (all.length < wanted) {
    const size = Math.min(pageSize, wanted - all.length);
    const { data, error } = await buildQuery(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < size) break;
    from += size;
  }
  return all.slice(0, wanted);
}
