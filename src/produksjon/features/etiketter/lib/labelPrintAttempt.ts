/**
 * Fryst utskriftsforsøk for etiketter.
 *
 * Da bekreftelsen leste `selectedUnits` direkte, kunne innkommende realtime-
 * oppdateringer bytte ut settet mellom «Skriv ut» og «Ja, skrevet ut» — da ble
 * feil numre registrert. Her fryses numrene og jobb-id-ene i det øyeblikket
 * PDF-en lages, og bekreftelsen sender nøyaktig det samme settet til serveren.
 *
 * Serveren (`label_units_mark_printed`) logger jobbene og teller opp
 * `print_count` i én transaksjon, og samme jobb-id teller aldri to ganger.
 */
import { supabase } from "@/integrations/supabase/client";
import type { LabelUnit } from "../hooks/useLabelUnits";

export interface LabelPrintAttemptUnit {
  unitId: string;
  number: number;
  /** Klientgenerert idempotensnøkkel — én per etikett per forsøk. */
  jobId: string;
}

export interface LabelPrintAttempt {
  legalEntityId: string;
  departmentId: string;
  profileId: string | null;
  productId: string;
  units: LabelPrintAttemptUnit[];
}

export interface LabelPrintAttemptResult {
  counted: number;
  alreadyLogged: number;
}

export function buildLabelPrintAttempt(input: {
  legalEntityId: string;
  departmentId: string;
  profileId: string | null;
  productId: string;
  units: LabelUnit[];
}): LabelPrintAttempt {
  return {
    legalEntityId: input.legalEntityId,
    departmentId: input.departmentId,
    profileId: input.profileId,
    productId: input.productId,
    units: input.units.map((u) => ({
      unitId: u.id,
      number: u.number,
      jobId: crypto.randomUUID(),
    })),
  };
}

/** Numrene i forsøket, til bruk i meldinger. */
export function attemptNumbers(attempt: LabelPrintAttempt): number[] {
  return attempt.units.map((u) => u.number);
}

export async function submitLabelPrintAttempt(
  attempt: LabelPrintAttempt,
  status: "printed" | "failed",
): Promise<LabelPrintAttemptResult> {
  if (attempt.units.length === 0) {
    throw new Error("Utskriftsforsøket inneholder ingen etikettnumre.");
  }
  const { data, error } = await supabase.rpc("label_units_mark_printed", {
    p_legal_entity_id: attempt.legalEntityId,
    p_department_id: attempt.departmentId,
    p_profile_id: attempt.profileId,
    p_status: status,
    p_jobs: attempt.units.map((u) => ({ job_id: u.jobId, label_unit_id: u.unitId })),
  } as never);
  if (error) throw error;
  const res = (data ?? {}) as { counted?: number; already_logged?: number };
  return {
    counted: Number(res.counted ?? 0),
    alreadyLogged: Number(res.already_logged ?? 0),
  };
}
