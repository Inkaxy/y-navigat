import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { markPrinted } from "@/ordre/lib/cakeImages";
import { printCakeItems, type CakePrintItem } from "@/ordre/lib/cakePrint";
import { loadCakePrintItems } from "@/ordre/lib/cakePrintJob";
import {
  PrintOutcomeDialog,
  type PrintOutcome,
} from "@/ordre/components/cake-images/PrintOutcomeDialog";

type Pending = {
  freshIds: string[];
  againIds: string[];
  sheet: string;
  count: number;
};

export type CakePrintFlowOptions = {
  scale?: number;
  scaleY?: number;
  printerLabel?: string | null;
  scaleAppliedPct?: number | null;
};

/**
 * Én vei til papiret: bygg PDF i samme fane, åpne utskriftsdialogen, og
 * spør etterpå om arket kom riktig ut. Status settes bare på «Ja».
 */
export function useCakePrintFlow(opts: CakePrintFlowOptions = {}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const run = useCallback(
    async (items: CakePrintItem[], statusById: Record<string, string>) => {
      if (items.length === 0) {
        toast.error("Ingen kakebilder å skrive ut");
        return;
      }
      setBusy(true);
      try {
        const res = await printCakeItems(items, {
          scale: optsRef.current.scale ?? 1,
          scaleY: optsRef.current.scaleY ?? optsRef.current.scale ?? 1,
        });
        if (res.skipped.length > 0) {
          toast.warning(
            `Hoppet over ${res.skipped.length} bilde(r): ${res.skipped
              .map((s) => `${s.item.labelNumber ?? s.item.title ?? "uten navn"} — ${s.reason}`)
              .join(" · ")}`,
          );
        }
        const ids = res.printedItems
          .map((i) => i.image?.id)
          .filter(Boolean) as string[];
        if (ids.length === 0) return;
        setPending({
          freshIds: ids.filter((id) => statusById[id] !== "skrevet_ut"),
          againIds: ids.filter((id) => statusById[id] === "skrevet_ut"),
          sheet: res.sheet,
          count: ids.length,
        });
      } catch (e) {
        console.error("[useCakePrintFlow] utskrift feilet", e);
        toast.error((e as Error).message || "Kunne ikke starte utskriften");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /** Henter bildene selv (fra listen) og skriver ut. */
  const printIds = useCallback(
    async (ids: string[]) => {
      setBusy(true);
      try {
        const { items, images } = await loadCakePrintItems(ids);
        const statusById = Object.fromEntries(images.map((i) => [i.id, i.status]));
        await run(items, statusById);
      } catch (e) {
        console.error("[useCakePrintFlow] kunne ikke hente kakebildene", e);
        toast.error("Kunne ikke hente kakebildene");
        setBusy(false);
      }
    },
    [run],
  );

  const resolve = useCallback(
    async (outcome: PrintOutcome) => {
      const job = pending;
      setPending(null);
      if (!job || "cancelled" in outcome) return;
      const printer = {
        printerLabel: optsRef.current.printerLabel ?? null,
        scaleAppliedPct: optsRef.current.scaleAppliedPct ?? null,
      };
      try {
        if (outcome.ok) {
          if (job.freshIds.length)
            await markPrinted(job.freshIds, "print", job.sheet, null, printer);
          if (job.againIds.length)
            await markPrinted(job.againIds, "reprint", job.sheet, null, printer);
          toast.success(`${job.count} kakebilde(r) registrert som skrevet ut`);
        } else {
          const note = outcome.reason ? `feiltrykk: ${outcome.reason}` : "feiltrykk";
          await markPrinted(
            [...job.freshIds, ...job.againIds],
            "test",
            job.sheet,
            note,
            printer,
          );
          toast.message("Feiltrykk registrert — status er uendret");
        }
        qc.invalidateQueries({ queryKey: ["cake-images"] });
        qc.invalidateQueries({ queryKey: ["cake-image-prints"] });
      } catch (e) {
        console.error("[useCakePrintFlow] kunne ikke registrere utskriften", e);
        toast.error("Kunne ikke registrere utskriften");
      }
    },
    [pending, qc],
  );

  const dialog = (
    <PrintOutcomeDialog
      open={pending !== null}
      count={pending?.count ?? 0}
      onResolve={(o) => void resolve(o)}
    />
  );

  return { busy, printItems: run, printIds, dialog };
}
