import type {
  PaymentEntry,
  PaymentMethod,
  PaymentSummary,
} from "@/pos_styring/lib/pos-types";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Norsk standard: 1-krone er minste myntenhet i sirkulasjon.
// Avrund kontant-total til nærmeste 1,00 kr (banker's-style halfway → opp).
export function roundCash(totalIncl: number): number {
  return Math.round(totalIncl);
}

export interface BuildPaymentInput {
  method: PaymentMethod;
  totalIncl: number;       // kurvens total_incl_mva
  cashReceived?: number;   // kun for method='cash'
  reference?: string;      // f.eks. Vipps-ref, kort-batch
  cardBrand?: string;      // valgfri ved kort
}

// Tilfredsstiller RPC-invarianten: total_paid - rounding === totalIncl (±0.01).
// Kort/Vipps/faktura/gavekort/annet: rounding=0, total_paid=totalIncl.
// Kontant: total_paid=roundCash(totalIncl), rounding=total_paid-totalIncl,
//          change_given = max(0, cashReceived - total_paid).
export function buildPaymentSummary(input: BuildPaymentInput): PaymentSummary & {
  rounding: number;
  change_given: number;
} {
  const totalIncl = round2(input.totalIncl);

  if (input.method === "cash") {
    const total_paid = round2(roundCash(totalIncl));
    const rounding = round2(total_paid - totalIncl);
    const received = round2(input.cashReceived ?? total_paid);
    const change_given = round2(Math.max(0, received - total_paid));
    const entry: PaymentEntry = { method: "cash", amount: total_paid };
    const summary = {
      payments: [entry],
      total_paid,
      change_given,
      rounding,
    };
    assertInvariant(summary);
    return summary;
  }

  const total_paid = totalIncl;
  const rounding = 0;
  const entry: PaymentEntry = { method: input.method, amount: total_paid };
  if (input.reference) entry.reference = input.reference;
  if (input.cardBrand && input.method === "card") entry.card_brand = input.cardBrand;
  const summary = {
    payments: [entry],
    total_paid,
    change_given: 0,
    rounding,
  };
  assertInvariant(summary);
  return summary;
}

function assertInvariant(s: { total_paid: number; rounding: number } & {
  payments: PaymentEntry[];
}) {
  // RPC-en validerer: |total_paid - rounding - totalIncl| <= 0.01
  // Vi kan ikke re-validere mot totalIncl her uten å få den inn, men vi sjekker
  // at payments-sum stemmer med total_paid (vår egen invariant).
  const paymentsSum = s.payments.reduce((a, p) => a + p.amount, 0);
  if (Math.abs(round2(paymentsSum) - round2(s.total_paid)) > 0.01) {
    throw new Error(
      `payments.amount sum (${paymentsSum}) ≠ total_paid (${s.total_paid})`,
    );
  }
}

// Eksternt sjekk-punkt: kall denne RETT FØR rpc-kall for å være helt sikker.
export function verifyAgainstTotal(
  summary: { total_paid: number; rounding: number },
  totalIncl: number,
): void {
  const diff = Math.abs(
    round2(summary.total_paid - summary.rounding) - round2(totalIncl),
  );
  if (diff > 0.01) {
    throw new Error(
      `Payment mismatch i klient: total_paid(${summary.total_paid}) - rounding(${summary.rounding}) ≠ total_incl_mva(${totalIncl}) (diff=${diff})`,
    );
  }
}
