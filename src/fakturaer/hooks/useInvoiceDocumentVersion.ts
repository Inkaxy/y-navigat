import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/useCompany";
import type { Json } from "@/integrations/supabase/types";
import { versionKey } from "@/fakturaer/lib/priceSafety";

/**
 * Gjeldende identitet for fakturaens private original (`rm_invoice_document_version`).
 * `version` er et ugjennomsiktig cache-token — ikke en innholdshash eller adresse til historiske bytes.
 */
export type DocumentVersion =
  | { available: true; invoice_id: string; path: string; object_id: string; version: string; storage_version: string | null; updated_at: string | null }
  | { available: false; invoice_id: string; reason: "document_missing" | "document_path_invalid" };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

export function parseDocumentVersion(data: Json | unknown, invoiceId: string): DocumentVersion | null {
  if (!isRec(data) || data.invoice_id !== invoiceId) return null;
  if (data.available === false) {
    return data.reason === "document_missing" || data.reason === "document_path_invalid" ? { available: false, invoice_id: invoiceId, reason: data.reason } : null;
  }
  if (data.available !== true) return null;
  const path = str(data.path), objectId = str(data.object_id), version = str(data.version);
  if (!path || !objectId || !version) return null;
  return { available: true, invoice_id: invoiceId, path, object_id: objectId, version, storage_version: str(data.storage_version), updated_at: str(data.updated_at) };
}

export const DOC_VERSION_KEY = "invoice-document-version" as const;

export async function fetchDocumentVersion(invoiceId: string, signal?: AbortSignal): Promise<DocumentVersion> {
  let rpc = supabase.rpc("rm_invoice_document_version", { p_invoice_id: invoiceId });
  if (signal) rpc = rpc.abortSignal(signal);
  const { data, error } = await rpc;
  if (error) throw error;
  const parsed = parseDocumentVersion(data, invoiceId);
  if (!parsed) throw new Error("ugyldig_dokumentversjon");
  return parsed;
}

/** Ferskt oppslag ved åpning, fokus og eksplisitt oppdatering. Nøkkelen inkluderer selskap. */
export function useInvoiceDocumentVersion(invoiceId: string | null | undefined) {
  const { data: company } = useCompany();
  const qc = useQueryClient();
  const key = [DOC_VERSION_KEY, invoiceId ?? null, company?.id ?? null] as const;
  const q = useQuery({
    queryKey: key,
    enabled: !!invoiceId && !!company?.id,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: ({ signal }) => fetchDocumentVersion(invoiceId as string, signal),
  });
  /** Leser identiteten på nytt (etter nedlasting) uten å bruke cache. */
  const recheck = async (): Promise<string | null> => {
    if (!invoiceId) return null;
    const v = await fetchDocumentVersion(invoiceId);
    return v.available ? `${v.path}|${v.version}` : null;
  };
  const refresh = () => void qc.invalidateQueries({ queryKey: [DOC_VERSION_KEY, invoiceId ?? null] });
  return { ...q, recheck, refresh };
}

/** Sammenlign gjeldende original med lesingens frosne dokument (id, sti, lagringsversjon, tidspunkt). */
export function snapshotDocumentMatch(snapshot: Json | null | undefined, current: DocumentVersion | null | undefined): "match" | "changed" | "unknown" {
  if (!current) return "unknown";
  const doc = isRec(snapshot) && isRec(snapshot.document) ? snapshot.document : null;
  if (!doc) return "unknown";
  if (!current.available) return "changed";
  const same = doc.id === current.object_id && doc.name === current.path
    && (str(doc.version) ?? null) === current.storage_version
    && versionKey(str(doc.updated_at)) === versionKey(current.updated_at);
  return same ? "match" : "changed";
}
