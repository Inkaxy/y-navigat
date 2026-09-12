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

  // Serveren MÅ svare med et komplett resultat. Et tomt svar ble tidligere
  // tolket som «0 registrert, alt i orden» — det ga falsk suksess.
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Serveren bekreftet ikke utskriften. Etikettene står fortsatt som uutskrevet.");
  }
  const res = data as {
    status?: unknown;
    counted?: unknown;
    already_logged?: unknown;
    units?: unknown;
  };
  if (res.status !== status) {
    throw new Error("Serveren bekreftet en annen utskriftsstatus enn den som ble sendt.");
  }
  const counted = Number(res.counted);
  const alreadyLogged = Number(res.already_logged);
  if (!Number.isFinite(counted) || !Number.isFinite(alreadyLogged)) {
    throw new Error("Serveren svarte uten gyldig antall registrerte etiketter.");
  }
  if (!Array.isArray(res.units)) {
    throw new Error("Serveren svarte uten oversikt over etikettene.");
  }
  const confirmed = new Set(
    res.units
      .map((u) => (u && typeof u === "object" ? (u as { id?: unknown }).id : null))
      .filter((id): id is string => typeof id === "string"),
  );
  const missing = attempt.units.filter((u) => !confirmed.has(u.unitId));
  if (missing.length > 0) {
    throw new Error(
      `Serveren bekreftet ikke alle etikettene (mangler ${missing.map((m) => m.number).join(", ")}).`,
    );
  }
  if (status === "printed" && counted + alreadyLogged < attempt.units.length) {
    throw new Error("Serveren registrerte færre etiketter enn det ble skrevet ut.");
  }
  return { counted, alreadyLogged };
}
