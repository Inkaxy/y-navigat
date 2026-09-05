import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createNotifications } from "@/ordre/hooks/useNotifications";
import {
  pickSlaBreaches,
  readNotifiedBreaches,
  rememberNotifiedBreaches,
  type SlaBreachCandidate,
} from "@/ordre/lib/slaBreach";
import { logAppError } from "@/lib/errorLog";

/**
 * Oppretter `ticket.sla_breach`-varsel når en sak brukeren eier eller har åpen
 * passerer fristen. Kjøres klientside fordi SLA-fristen beregnes i frontend.
 */
export function useSlaBreachNotifications(
  rows: SlaBreachCandidate[],
  userId: string | null,
  openTicketId?: string | null,
) {
  const qc = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    if (!userId || running.current) return;
    const breaches = pickSlaBreaches(rows, {
      userId,
      openTicketId,
      alreadyNotified: readNotifiedBreaches(),
    });
    if (breaches.length === 0) return;

    running.current = true;
    // Merk lokalt først: varselet skal aldri sendes to ganger for samme sak.
    rememberNotifiedBreaches(breaches.map((b) => b.id));
    void createNotifications(
      breaches.map((b) => ({
        user_id: userId,
        type: "ticket.sla_breach",
        title: "Frist passert",
        body: b.subject ?? "Henvendelse uten emne",
        link: `/ordre/ticket/${b.id}`,
        ticket_id: b.id,
        refund_id: null,
        order_id: null,
      })),
    )
      .then(() => {
        qc.invalidateQueries({ queryKey: ["notifications"] });
      })
      .catch((e: unknown) => {
        logAppError(e, { scope: "ordre:sla-breach-varsel" });
      })
      .finally(() => {
        running.current = false;
      });
  }, [rows, userId, openTicketId, qc]);
}
