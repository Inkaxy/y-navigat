import { useCallback, useEffect, useRef, useState } from "react";
import { useApplyRmStockCount } from "@/ravarer/hooks/useStockCount";
import {
  clearPendingSubmission,
  CountOutcomeUnknownError,
  CountRejectedError,
  loadPendingSubmission,
  savePendingSubmission,
  type CountResult,
  type PendingCountSubmission,
} from "@/ravarer/lib/countSubmission";
import { fetchCountSheetStatus } from "@/ravarer/lib/countSheets";

/** Avstemming av den opprinnelige operasjonen etter 23505 (samme ID, annet innhold). */
export type Reconciliation = "none" | "checking" | "applied" | "not_applied" | "error";

export type SubmissionState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "unknown" }
  | { kind: "rejected"; error: CountRejectedError; reconciliation: Reconciliation };

/**
 * Eier én innsendt telling til utfallet er avklart.
 *
 * - Innsendingen (opId + ordnede linjer + notat) lagres lokalt FØR kallet.
 * - Nytt forsøk sender nøyaktig samme innsending, uansett hva skjemaet viser nå.
 * - Synkron lås: dobbelttrykk sender én gang.
 * - Innsendingen er bundet til selskapet den ble laget i; den sendes aldri i et annet selskap.
 * - Nye sideeffekter krever gjeldende skrivetilgang (serveren er fortsatt autoritativ).
 * - 23505 frigjøres bare etter autoritativ lesing av den opprinnelige operasjonen.
 */
export function useCountSubmission(legalEntityId: string | null | undefined, canWrite = true) {
  const apply = useApplyRmStockCount();
  const [pending, setPending] = useState<PendingCountSubmission | null>(() => loadPendingSubmission(legalEntityId));
  const [state, setState] = useState<SubmissionState>(() => (loadPendingSubmission(legalEntityId) ? { kind: "unknown" } : { kind: "idle" }));
  const lock = useRef(false);
  const mounted = useRef(true);
  const live = useRef({ legalEntityId, canWrite });
  live.current = { legalEntityId, canWrite };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const send = useCallback(
    async (sub: PendingCountSubmission): Promise<CountResult | null> => {
      if (lock.current) return null;
      if (!live.current.canWrite || sub.legalEntityId !== live.current.legalEntityId) return null;
      lock.current = true;
      // Uten lokal kopi kan et tapt svar ikke gjenopprettes med samme innhold — da sendes ikke tellingen.
      if (!savePendingSubmission(sub)) {
        lock.current = false;
        if (mounted.current) setState({ kind: "rejected", reconciliation: "none", error: new CountRejectedError("rejected", "Tellingen kunne ikke lagres lokalt før innsending. Ingenting er sendt.") });
        return null;
      }
      if (mounted.current) {
        setPending(sub);
        setState({ kind: "sending" });
      }
      try {
        const res = await apply.mutateAsync({ opId: sub.opId, lines: sub.lines, note: sub.note });
        // Avklart: bokført. Ryddes for innsendingens eget selskap, også om siden er lukket.
        clearPendingSubmission(sub.legalEntityId);
        if (mounted.current && live.current.legalEntityId === sub.legalEntityId) {
          setPending(null);
          setState({ kind: "idle" });
        }
        return mounted.current && live.current.legalEntityId === sub.legalEntityId ? res : null;
      } catch (e) {
        if (mounted.current && live.current.legalEntityId === sub.legalEntityId) {
          if (e instanceof CountRejectedError) setState({ kind: "rejected", error: e, reconciliation: "none" });
          else setState({ kind: "unknown" });
        }
        if (!(e instanceof CountRejectedError) && !(e instanceof CountOutcomeUnknownError)) {
          console.warn("[varetelling] uventet feil", e);
        }
        return null;
      } finally {
        lock.current = false;
      }
    },
    [apply],
  );

  /** Sender den lagrede innsendingen på nytt, uendret — bare i samme selskap og med skrivetilgang. */
  const retry = useCallback(
    () => (pending && pending.legalEntityId === legalEntityId && canWrite ? send(pending) : Promise.resolve(null)),
    [pending, send, legalEntityId, canWrite],
  );

  /**
   * 23505: les status for den OPPRINNELIGE operasjons-ID-en. Bokført → avklart (ingen ny telling
   * nødvendig). Ikke bokført → brukeren kan bevisst starte en ny telling. Feil → forblir låst.
   */
  const reconcile = useCallback(async () => {
    if (state.kind !== "rejected" || state.error.kind !== "content" || !pending) return;
    const sub = pending;
    const err = state.error;
    setState({ kind: "rejected", error: err, reconciliation: "checking" });
    const r = await fetchCountSheetStatus(sub.legalEntityId, sub.opId);
    if (!mounted.current || live.current.legalEntityId !== sub.legalEntityId) return;
    const rec: Reconciliation =
      r.kind === "error" ? "error"
        : r.kind === "found" && (r.status === "applied" || r.status === "applying") ? (r.status === "applied" ? "applied" : "error")
          : "not_applied";
    setState({ kind: "rejected", error: err, reconciliation: rec });
  }, [state, pending]);

  /**
   * Frigjør en BEVIST avvist innsending. Ukjent utfall frigjøres aldri her. 23505 krever
   * avstemt opprinnelig operasjon. Innsendingens egen nøkkel ryddes — aldri et annet selskaps.
   */
  const release = useCallback(() => {
    if (state.kind !== "rejected" || !canWrite) return false;
    if (state.error.kind === "content" && state.reconciliation !== "not_applied" && state.reconciliation !== "applied") return false;
    if (pending && pending.legalEntityId !== legalEntityId) return false;
    clearPendingSubmission(pending?.legalEntityId ?? legalEntityId ?? "");
    setPending(null);
    setState({ kind: "idle" });
    return true;
  }, [state, pending, legalEntityId, canWrite]);

  const locked = pending != null || state.kind === "sending";
  return { pending, state, send, retry, release, reconcile, locked, isSending: state.kind === "sending" };
}
