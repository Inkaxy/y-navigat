// Enkel in-memory-transport for edge-tester: nok PostgREST-semantikk til å
// kjøre den faktiske handleren (select/eq/in/is/or/limit, update, insert,
// upsert, delete, rpc) uten å røre en ekte database.

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

interface Filter {
  kind: "eq" | "in" | "is" | "neq";
  col: string;
  value: unknown;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.col];
    switch (f.kind) {
      case "eq":
        return String(v) === String(f.value);
      case "neq":
        return String(v) !== String(f.value);
      case "in":
        return Array.isArray(f.value) && f.value.some((x) => String(x) === String(v));
      case "is":
        return f.value === null ? v === null || v === undefined : v === f.value;
    }
  });
}

export interface FakeClientOptions {
  /** Tabeller som skal svare med feil i stedet for data. */
  failTables?: Record<string, string>;
  /** Svar per RPC-navn. */
  rpc?: Record<string, unknown>;
}

export function createFakeClient(tables: Tables, options: FakeClientOptions = {}) {
  const rowsOf = (table: string): Row[] => (tables[table] ??= []);

  function builder(table: string) {
    const filters: Filter[] = [];
    let mode: "select" | "update" | "delete" | "insert" | "upsert" = "select";
    let payload: Row | Row[] | null = null;
    let limitN: number | null = null;

    const failure = options.failTables?.[table];

    const run = () => {
      if (failure) return { data: null, error: { message: failure } };
      const rows = rowsOf(table);
      if (mode === "insert" || mode === "upsert") {
        const src = Array.isArray(payload) ? payload : payload ? [payload] : [];
        // Databasen gir radene en id. Uten den kan ikke en importert faktura
        // sendes videre til matchemotoren i en integrasjonstest.
        const list = src.map((r, i) => ({ id: r.id ?? `${table}-${rows.length + i + 1}`, ...r }));
        rows.push(...list.map((r) => ({ ...r })));
        return { data: list, error: null };
      }
      const hit = rows.filter((r) => matches(r, filters));
      if (mode === "update") {
        for (const r of hit) Object.assign(r, payload as Row);
        return { data: hit, error: null };
      }
      if (mode === "delete") {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return { data: hit, error: null };
      }
      return { data: limitN == null ? hit : hit.slice(0, limitN), error: null };
    };

    const chain = {
      select: () => chain,
      order: () => chain,
      or: () => chain,
      not: () => chain,
      eq: (col: string, value: unknown) => {
        filters.push({ kind: "eq", col, value });
        return chain;
      },
      neq: (col: string, value: unknown) => {
        filters.push({ kind: "neq", col, value });
        return chain;
      },
      in: (col: string, value: unknown[]) => {
        filters.push({ kind: "in", col, value });
        return chain;
      },
      is: (col: string, value: unknown) => {
        filters.push({ kind: "is", col, value });
        return chain;
      },
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      update: (values: Row) => {
        mode = "update";
        payload = values;
        return chain;
      },
      delete: () => {
        mode = "delete";
        return chain;
      },
      insert: (values: Row | Row[]) => {
        mode = "insert";
        payload = values;
        return chain;
      },
      upsert: (values: Row | Row[]) => {
        mode = "upsert";
        payload = values;
        return chain;
      },
      maybeSingle: async () => {
        const res = run();
        const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
        return { data, error: res.error };
      },
      single: async () => {
        const res = run();
        const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
        return { data, error: res.error ?? (data ? null : { message: "not found" }) };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  }

  return {
    from: (table: string) => builder(table),
    rpc: async (name: string) => ({ data: options.rpc?.[name] ?? null, error: null }),
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  };
}
