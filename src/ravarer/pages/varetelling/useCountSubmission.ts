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

export type SubmissionState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "unknown" }
  | { kind: "rejected"; error: CountRejectedError };

/**
 * Eier én innsendt telling til utfallet er avklart.
 *
 * - Innsendingen (opId + ordnede linjer + notat) lagres lokalt FØR kallet.
 * - Nytt forsøk sender nøyaktig samme innsending, uansett hva skjemaet viser nå.
 * - Synkron lås: dobbelttrykk sender én gang.
 * - Bare bokført svar (eller bevist avvisning + eksplisitt valg) frigjør tellingen.
 */
export function useCountSubmission(legalEntityId: string | null | undefined) {
  const apply = useApplyRmStockCount();
  const [pending, setPending] = useState<PendingCountSubmission | null>(() => loadPendingSubmission(legalEntityId));
  const [state, setState] = useState<SubmissionState>(() => (loadPendingSubmission(legalEntityId) ? { kind: "unknown" } : { kind: "idle" }));
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const send = useCallback(
    async (sub: PendingCountSubmission): Promise<CountResult | null> => {
      if (lock.current) return null;
      lock.current = true;
      // Uten lokal kopi kan et tapt svar ikke gjenopprettes med samme innhold — da sendes ikke tellingen.
      if (!savePendingSubmission(sub)) {
        lock.current = false;
        if (mounted.current) setState({ kind: "rejected", error: new CountRejectedError("rejected", "Tellingen kunne ikke lagres lokalt før innsending. Ingenting er sendt.") });
        return null;
      }
      if (mounted.current) {
        setPending(sub);
        setState({ kind: "sending" });
      }
      try {
        const res = await apply.mutateAsync({ opId: sub.opId, lines: sub.lines, note: sub.note });
        // Avklart: bokført. Ryddes også om siden er lukket i mellomtiden.
        clearPendingSubmission(sub.legalEntityId);
        if (mounted.current) {
          setPending(null);
          setState({ kind: "idle" });
        }
        return res;
      } catch (e) {
        if (mounted.current) {
          if (e instanceof CountRejectedError) setState({ kind: "rejected", error: e });
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

  /** Sender den lagrede innsendingen på nytt, uendret. */
  const retry = useCallback(() => (pending ? send(pending) : Promise.resolve(null)), [pending, send]);

  /**
   * Frigjør en BEVIST avvist innsending, slik at tellingen kan redigeres.
   * Ukjent utfall frigjøres aldri her — det må sendes på nytt for å få svar.
   */
  const release = useCallback(() => {
    if (state.kind !== "rejected" || !legalEntityId) return false;
    clearPendingSubmission(legalEntityId);
    setPending(null);
    setState({ kind: "idle" });
    return true;
  }, [state.kind, legalEntityId]);

  const locked = pending != null || state.kind === "sending";
  return { pending, state, send, retry, release, locked, isSending: state.kind === "sending" };
}
