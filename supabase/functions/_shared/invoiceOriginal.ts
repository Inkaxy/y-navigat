// Henter original-PDF for en faktura med samme kontroll som visningen: bundet sti+versjon fra
// rm_invoice_document_version (brukerens tilgang + selskapssti) før OG etter nedlasting.
// Ingen offentlig URL/token lages eller returneres; bytene leses én gang.

export type OriginalStatus = "ok" | "mangler" | "ukjent" | "for_stor" | "endret";
export interface OriginalResult { status: OriginalStatus; bytes: Uint8Array | null; version: string | null }

export interface OriginalDeps {
  documentVersion(signal: AbortSignal): Promise<{ ok: boolean; available?: boolean; path?: string; version?: string }>;
  download(path: string, signal: AbortSignal): Promise<Uint8Array | null>;
  maxBytes: number;
  /** Frist per steg (RPC før, nedlasting, RPC etter). */
  stepTimeoutMs?: number;
}

export const ORIGINAL_STEP_TIMEOUT_MS = 10_000;

/** Kjører ett steg med egen AbortSignal; tidsfrist avbryter arbeidet og gir null (= ukjent). */
async function step<T>(ms: number, run: (s: AbortSignal) => Promise<T>): Promise<T | null> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(ctl.signal),
      new Promise<null>((res) => { timer = setTimeout(() => { ctl.abort(); res(null); }, ms); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    ctl.abort();
  }
}

export async function fetchVerifiedOriginal(d: OriginalDeps): Promise<OriginalResult> {
  const ms = d.stepTimeoutMs ?? ORIGINAL_STEP_TIMEOUT_MS;
  const v1 = await step(ms, (s) => d.documentVersion(s));
  if (!v1 || !v1.ok) return { status: "ukjent", bytes: null, version: null };
  if (!v1.available || !v1.path || !v1.version) return { status: "mangler", bytes: null, version: null };
  const path = v1.path, version = v1.version;
  const bytes = await step(ms, (s) => d.download(path, s));
  if (!bytes) return { status: "ukjent", bytes: null, version };
  if (bytes.byteLength > d.maxBytes) return { status: "for_stor", bytes: null, version };
  const v2 = await step(ms, (s) => d.documentVersion(s));
  if (!v2 || !v2.ok) return { status: "ukjent", bytes: null, version };
  if (v2.version !== version || v2.path !== path) return { status: "endret", bytes: null, version };
  return { status: "ok", bytes, version };
}

interface RpcCall { abortSignal(s: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> }
export interface UserRpcClient { rpc(fn: string, args: Record<string, unknown>): RpcCall }
export interface StorageClient {
  storage: { from(bucket: string): { download(path: string, opts?: Record<string, unknown>, params?: { signal?: AbortSignal }): Promise<{ data: Blob | null; error: unknown }> } };
}

/** Standard avhengigheter mot Supabase (bruker-RPC + tjenestenedlasting av validert sti), begge med AbortSignal. */
export function supabaseOriginalDeps(userClient: UserRpcClient, admin: StorageClient, invoiceId: string, maxBytes: number): OriginalDeps {
  return {
    maxBytes,
    async documentVersion(signal) {
      const { data, error } = await userClient.rpc("rm_invoice_document_version", { p_invoice_id: invoiceId }).abortSignal(signal);
      if (error || !data || typeof data !== "object") return { ok: false };
      const o = data as Record<string, unknown>;
      return { ok: true, available: o.available === true, path: typeof o.path === "string" ? o.path : undefined, version: typeof o.version === "string" ? o.version : undefined };
    },
    async download(path, signal) {
      const { data, error } = await admin.storage.from("invoice-pdfs").download(path, undefined, { signal });
      if (error || !data) return null;
      if (data.size > maxBytes) return new Uint8Array(maxBytes + 1);
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
