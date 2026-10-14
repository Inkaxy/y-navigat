// Henter original-PDF for en faktura med samme kontroll som visningen: bundet sti+versjon fra
// rm_invoice_document_version (brukerens tilgang + selskapssti) før OG etter nedlasting.
// Ingen offentlig URL/token lages eller returneres; bytene leses én gang.

export type OriginalStatus = "ok" | "mangler" | "ukjent" | "for_stor" | "endret";
export interface OriginalResult { status: OriginalStatus; bytes: Uint8Array | null; version: string | null }

export interface OriginalDeps {
  documentVersion(): Promise<{ ok: boolean; available?: boolean; path?: string; version?: string }>;
  download(path: string): Promise<Uint8Array | null>;
  maxBytes: number;
}

export async function fetchVerifiedOriginal(d: OriginalDeps): Promise<OriginalResult> {
  const v1 = await d.documentVersion().catch(() => ({ ok: false }));
  if (!v1.ok) return { status: "ukjent", bytes: null, version: null };
  const doc = v1 as { available?: boolean; path?: string; version?: string };
  if (!doc.available || !doc.path || !doc.version) return { status: "mangler", bytes: null, version: null };
  let bytes: Uint8Array | null = null;
  try { bytes = await d.download(doc.path); } catch { bytes = null; }
  if (!bytes) return { status: "ukjent", bytes: null, version: doc.version };
  if (bytes.byteLength > d.maxBytes) return { status: "for_stor", bytes: null, version: doc.version };
  const v2 = await d.documentVersion().catch(() => ({ ok: false }));
  if (!v2.ok) return { status: "ukjent", bytes: null, version: doc.version };
  if ((v2 as { version?: string }).version !== doc.version || (v2 as { path?: string }).path !== doc.path) {
    return { status: "endret", bytes: null, version: doc.version };
  }
  return { status: "ok", bytes, version: doc.version };
}

/** Standard avhengigheter mot Supabase (bruker-RPC + tjenestenedlasting av validert sti). */
// deno-lint-ignore no-explicit-any
export function supabaseOriginalDeps(userClient: any, admin: any, invoiceId: string, maxBytes: number): OriginalDeps {
  return {
    maxBytes,
    async documentVersion() {
      const { data, error } = await userClient.rpc("rm_invoice_document_version", { p_invoice_id: invoiceId });
      if (error || !data || typeof data !== "object") return { ok: false };
      const o = data as Record<string, unknown>;
      return { ok: true, available: o.available === true, path: typeof o.path === "string" ? o.path : undefined, version: typeof o.version === "string" ? o.version : undefined };
    },
    async download(path: string) {
      const { data, error } = await admin.storage.from("invoice-pdfs").download(path);
      if (error || !data) return null;
      if (data.size > maxBytes) return new Uint8Array(maxBytes + 1);
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
