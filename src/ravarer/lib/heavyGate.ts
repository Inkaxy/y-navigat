/**
 * Tunge arbeidsoppslag (rm_work_items, rm_work_summary) regner hele selskapets fakturalinjer ved hvert kall.
 * Flere samtidige kall fra samme fane gikk ut på tid sammen (statement_timeout 8 s for innloggede brukere).
 * Porten slipper derfor høyst `max` kall gjennom om gangen; resten venter i kø. Lav prioritet (bare tellere)
 * venter litt før de stiller seg i køen, slik at sidens egen liste går først og kan dele tellerne sine.
 *
 * Et kall som allerede er sendt, avbrytes aldri fra porten (serveren ville regnet videre uansett); porten
 * frigjøres først når svaret faktisk er kommet. Kall som fortsatt venter i køen, fjernes ved avbrudd.
 */
export type GateOptions = { low?: boolean; signal?: AbortSignal };
export type Gate = {
  run<T>(fn: () => Promise<T>, o?: GateOptions): Promise<T>;
  readonly active: number;
  readonly queued: number;
};

const abortError = (): Error => Object.assign(new Error("Avbrutt"), { name: "AbortError" });

export function createGate(max = 1, lowDelayMs = 600): Gate {
  let active = 0;
  type Job = { low: boolean; start: () => void };
  const queue: Job[] = [];
  let pending = 0; // lav prioritet som venter på forsinkelsen
  const pump = () => {
    while (active < max && queue.length > 0) {
      const hi = queue.findIndex((j) => !j.low);
      const [job] = queue.splice(hi >= 0 ? hi : 0, 1);
      active++;
      job.start();
    }
  };
  return {
    get active() { return active; },
    get queued() { return queue.length + pending; },
    run<T>(fn: () => Promise<T>, o: GateOptions = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (o.signal?.aborted) { reject(abortError()); return; }
        let timer: ReturnType<typeof setTimeout> | null = null;
        const job: Job = {
          low: o.low === true,
          start: () => {
            o.signal?.removeEventListener("abort", onAbort);
            let p: Promise<T>;
            try { p = fn(); } catch (e) { p = Promise.reject(e); }
            p.then(resolve, reject).finally(() => { active--; pump(); });
          },
        };
        const onAbort = () => {
          if (timer) { clearTimeout(timer); timer = null; pending--; reject(abortError()); return; }
          const i = queue.indexOf(job);
          if (i >= 0) { queue.splice(i, 1); reject(abortError()); }
        };
        o.signal?.addEventListener("abort", onAbort, { once: true });
        if (job.low && lowDelayMs > 0) {
          pending++;
          timer = setTimeout(() => { timer = null; pending--; queue.push(job); pump(); }, lowDelayMs);
        } else {
          queue.push(job);
          pump();
        }
      });
    },
  };
}

/** Felles port for Råvarers tunge arbeidsoppslag i denne fanen. */
export const workGate: Gate = createGate(1);

/**
 * Forbigående feil som er verdt ett nytt forsøk: tidsavbrudd i databasen, tilkoblingsfeil og nettverksbrudd.
 * Tilgangsfeil, ukjent gruppe o.l. prøves aldri på nytt.
 */
export function isTransientDbError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const o = e as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof o.code === "string" ? o.code : "";
  const msg = typeof o.message === "string" ? o.message : "";
  if (code === "57014" || /statement timeout|canceling statement/i.test(msg)) return true;
  if (code === "PGRST000" || code === "PGRST001" || code === "PGRST003") return true;
  if (typeof o.status === "number" && (o.status === 502 || o.status === 503 || o.status === 504)) return true;
  return /failed to fetch|networkerror|load failed|fetch failed/i.test(msg);
}

/** Ett automatisk nytt forsøk etter en pause, bare ved forbigående feil. */
export const TRANSIENT_RETRY = {
  retry: (failureCount: number, error: unknown) => failureCount < 1 && isTransientDbError(error),
  retryDelay: 2500,
} as const;
