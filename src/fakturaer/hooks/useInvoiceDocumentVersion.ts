import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthUserId } from "@/hooks/useAuth";
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

type GenState = { gen: number; revoked: boolean; certified: number };
const GEN_INITIAL: GenState = { gen: 1, revoked: false, certified: 0 };

export async function fetchDocumentVersion(invoiceId: string, signal?: AbortSignal): Promise<DocumentVersion> {
  let rpc = supabase.rpc("rm_invoice_document_version", { p_invoice_id: invoiceId });
  if (signal) rpc = rpc.abortSignal(signal);
  const { data, error } = await rpc;
  if (error) throw error;
  const parsed = parseDocumentVersion(data, invoiceId);
  if (!parsed) throw new Error("ugyldig_dokumentversjon");
  return parsed;
}

/**
 * Ferskt oppslag ved åpning, fokus, bruker-/selskapsbytte og eksplisitt oppdatering.
 * `verifiedCurrent` er satt BARE når identiteten er bekreftet i denne visningens verifiseringsepoke
 * (vellykket, ikke under henting, ingen feil, hentet etter epokestart, samme faktura og tilgangskontekst).
 * Bufret suksess fra før epoken teller aldri som verifisert.
 */
export function useInvoiceDocumentVersion(invoiceId: string | null | undefined) {
  const { data: company } = useCompany();
  const userId = useAuthUserId();
  const qc = useQueryClient();
  const companyId = company?.id ?? null;
  const accessScope = userId && companyId ? `${userId}|${companyId}` : null;
  const enabled = !!invoiceId && !!accessScope;
  const key = [DOC_VERSION_KEY, invoiceId ?? null, companyId, userId] as const;
  const [epoch, setEpoch] = useState(() => Date.now());
  const ctxRef = useRef<string | null>(null);
  const ctx = enabled ? `${invoiceId}|${accessScope}` : null;
  ctxRef.current = ctx;
  // Ny faktura eller tilgangskontekst starter ny verifisering.
  useEffect(() => { setEpoch(Date.now()); }, [ctx]);
  useEffect(() => {
    const onFocus = () => setEpoch(Date.now());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  // Delt verifiseringstilstand per faktura+bruker+selskap: monoton generasjon, tilbakekalling for
  // generasjonen, og hvilken generasjon som sist ble bekreftet av et ferskt metadataoppslag.
  // Kontroller og oppslag binder seg til generasjonen de startet i; utdaterte fullføringer ignoreres.
  const genKey = [DOC_VERSION_KEY, "gen", invoiceId ?? null, companyId, userId] as const;
  const readGen = (): GenState => qc.getQueryData<GenState>(genKey) ?? GEN_INITIAL;
  const gs = useQuery({ queryKey: genKey, queryFn: () => Promise.resolve(GEN_INITIAL), enabled: false, initialData: GEN_INITIAL, staleTime: Infinity, gcTime: Infinity });
  const st = gs.data ?? GEN_INITIAL;
  const q = useQuery({
    queryKey: key,
    enabled,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: async ({ signal }) => {
      const g = readGen().gen;
      const doc = await fetchDocumentVersion(invoiceId as string, signal);
      qc.setQueryData<GenState>(genKey, (o) => { const c = o ?? GEN_INITIAL; return c.gen === g && !c.revoked ? { ...c, certified: g } : c; });
      return doc;
    },
  });
  const revoked = enabled && st.revoked;
  /** Tilbakekall bare hvis generasjonen `g` fortsatt er gjeldende. */
  const revoke = (g: number) => {
    let applied = false;
    qc.setQueryData<GenState>(genKey, (o) => { const c = o ?? GEN_INITIAL; if (c.gen !== g) return c; applied = true; return { ...c, revoked: true }; });
    if (applied) void qc.cancelQueries({ queryKey: key });
  };
  const needsVerify = enabled && !revoked && !q.isFetching && !q.isError && q.dataUpdatedAt < epoch;
  // Én henting per epoke; feil stopper (ingen løkke) til bruker prøver igjen eller ny epoke starter.
  const { refetch } = q;
  useEffect(() => { if (needsVerify) void refetch(); }, [needsVerify, epoch, refetch]);
  const verifiedCurrent: DocumentVersion | null =
    enabled && !revoked && st.certified === st.gen && q.status === "success" && !q.isFetching && !q.isError && q.dataUpdatedAt >= epoch && q.data.invoice_id === invoiceId ? q.data : null;
  /**
   * Leser identiteten på nytt (før/etter nedlasting) uten cache. Bundet til generasjonen `generation`
   * (standard: gjeldende). Utdatert generasjon eller byttet kontekst → null, ingen tilbakekalling.
   */
  const recheck = async (expected?: string, generation?: number): Promise<string | null> => {
    const started = ctxRef.current;
    const g = generation ?? readGen().gen;
    const current = () => ctxRef.current === started && readGen().gen === g;
    if (!invoiceId || !started || !current()) return null;
    let v: DocumentVersion;
    try { v = await fetchDocumentVersion(invoiceId); } catch (e) {
      if (current()) { revoke(g); throw e; }
      return null;
    }
    if (!current()) return null;
    const ident = v.available ? `${v.path}|${v.version}` : null;
    if (ident === null || (expected !== undefined && ident !== expected)) revoke(g);
    return readGen().revoked ? null : ident;
  };
  /** Starter ny generasjon: verifisert først når et ferskt oppslag i den nye generasjonen lykkes. */
  const refresh = () => {
    qc.setQueryData<GenState>(genKey, (o) => { const c = o ?? GEN_INITIAL; return { gen: c.gen + 1, revoked: false, certified: c.certified }; });
    setEpoch(Date.now() + 1);
    void qc.invalidateQueries({ queryKey: [DOC_VERSION_KEY, invoiceId ?? null] });
  };
  return { ...q, verifiedCurrent, accessScope, revoked, generation: st.gen, verifying: enabled && !verifiedCurrent && !q.isError && !revoked, recheck, refresh };
}

/** Sammenlign gjeldende original med lesingens frosne dokument (id, sti, lagringsversjon, tidspunkt). */
export function snapshotDocumentMatch(snapshotDocument: Json | null | undefined, current: DocumentVersion | null | undefined): "match" | "changed" | "unknown" {
  if (!current) return "unknown";
  const doc = isRec(snapshotDocument) ? snapshotDocument : null;
  if (!doc) return "unknown";
  if (!current.available) return "changed";
  const same = doc.id === current.object_id && doc.name === current.path
    && (str(doc.version) ?? null) === current.storage_version
    && versionKey(str(doc.updated_at)) === versionKey(current.updated_at);
  return same ? "match" : "changed";
}
