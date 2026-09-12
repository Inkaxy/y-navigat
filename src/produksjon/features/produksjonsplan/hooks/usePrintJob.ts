import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "@/hooks/use-toast";
import {
  fetchLatestSnapshotItems,
  saveProductionPlanSnapshot,
  type SnapshotItem,
} from "./useProductionPlanSnapshots";
import {
  buildPrintAttempt,
  evaluatePrintGate,
  type PrintAttempt,
  type PrintOrderCounts,
  type PrintViewPrefs,
} from "../lib/printAttempt";
import type { ProductionPlanRow, ProduksjonsplanCriteria } from "../types";
import type { PrintProduksjonslisteOptions } from "../components/PrintProduksjonslisteDialog";

/**
 * Alt utskriften trenger, lest på det tidspunktet brukeren starter utskriften.
 * Leses via en ref slik at hele grunnlaget fryses ÉN gang — senere datoskifte
 * eller bakgrunnsfeil i planen skal ikke endre det som faktisk ble skrevet ut.
 */
export interface PrintJobSource {
  legalEntityId: string | null;
  dateStr: string;
  date: Date;
  rows: ProductionPlanRow[];
  criteria: ProduksjonsplanCriteria;
  counts: PrintOrderCounts | null;
  prefs: PrintViewPrefs;
  planUnavailable: boolean;
}

export interface UsePrintJobResult {
  /** Fryst forsøk som skal rendres i utskriftsområdet. */
  printJob: PrintAttempt | null;
  /** Fryst forsøk som venter på at brukeren bekrefter utskriften. */
  confirmPrint: PrintAttempt | null;
  preparingPrint: boolean;
  savingBaseline: boolean;
  printBusy: boolean;
  startPrint: (options: PrintProduksjonslisteOptions) => Promise<void>;
  confirmPrinted: () => Promise<void>;
  /** Brukeren svarte at utskriften ble avbrutt/feilet — ingen ny baseline. */
  dismissConfirm: () => void;
}

const PRINT_DELAY_MS = 100;
const CONFIRM_DELAY_MS = 500;

export function usePrintJob(source: PrintJobSource): UsePrintJobResult {
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const [printJob, setPrintJob] = useState<PrintAttempt | null>(null);
  const [confirmPrint, setConfirmPrint] = useState<PrintAttempt | null>(null);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const [savingBaseline, setSavingBaseline] = useState(false);
  // Ref, ikke state: to raske klikk skal blokkeres før React rekker å rendre.
  const busyRef = useRef(false);

  const printBusy = preparingPrint || !!printJob || !!confirmPrint;

  const startPrint = useCallback(async (options: PrintProduksjonslisteOptions) => {
    const src = sourceRef.current;
    const gate = evaluatePrintGate({
      legalEntityId: src.legalEntityId,
      planUnavailable: src.planUnavailable,
      rowCount: src.rows.length,
      busy: busyRef.current,
    });
    if (!gate.ok) {
      toast({
        title: gate.title,
        description: gate.description,
        variant: gate.reason === "empty" ? undefined : "destructive",
      });
      return;
    }

    busyRef.current = true;
    // Frys ALT før det asynkrone oppslaget, med ekte kopier av radene.
    const frozen = {
      attemptId: crypto.randomUUID(),
      legalEntityId: src.legalEntityId as string,
      dateStr: src.dateStr,
      date: new Date(src.date.getTime()),
      rows: src.rows.map((r) => ({ ...r })),
      criteria: { ...src.criteria },
      counts: src.counts ? { ...src.counts } : null,
      prefs: {
        columns: { ...src.prefs.columns },
        showByMainGroup: src.prefs.showByMainGroup,
        showTraysWithPlus: src.prefs.showTraysWithPlus,
      },
      options: { ...options },
      now: new Date(),
    };
    const wantCorrection = !!frozen.criteria.print_correction_last;

    setPreparingPrint(true);
    let prev: { takenAt: string; items: Map<string, SnapshotItem> } | null = null;
    try {
      if (wantCorrection) {
        const lookup = await fetchLatestSnapshotItems(
          frozen.legalEntityId,
          frozen.dateStr,
          frozen.criteria,
        );
        if (lookup.status === "error") {
          busyRef.current = false;
          toast({
            title: "Fant ikke forrige utskrift",
            description: "Korreksjonslisten kan bli feil. Utskrift er avbrutt — prøv igjen.",
            variant: "destructive",
          });
          return;
        }
        if (lookup.status === "none") {
          toast({
            title: "Ingen tidligere utskrift",
            description: "Korreksjonsliste hoppes over – listen skrives ut som vanlig.",
          });
        } else {
          prev = { takenAt: lookup.takenAt, items: lookup.items };
        }
      }
    } catch (e) {
      console.error("Snapshot-oppslag feilet", e);
      busyRef.current = false;
      toast({
        title: "Fant ikke forrige utskrift",
        description: "Korreksjonslisten kan bli feil. Utskrift er avbrutt — prøv igjen.",
        variant: "destructive",
      });
      return;
    } finally {
      setPreparingPrint(false);
    }

    const attempt = buildPrintAttempt({ ...frozen, prev, wantCorrection });

    flushSync(() => {
      setPrintJob(attempt);
    });

    setTimeout(() => {
      window.print();
      setTimeout(() => {
        setPrintJob(null);
        setConfirmPrint(attempt);
      }, CONFIRM_DELAY_MS);
    }, PRINT_DELAY_MS);
  }, []);

  const confirmPrinted = useCallback(async () => {
    const attempt = confirmPrint;
    if (!attempt) return;
    setSavingBaseline(true);
    try {
      // Alt hentes fra det frosne forsøket — aldri fra levende dato/kriterier.
      const saved = await saveProductionPlanSnapshot(
        attempt.attemptId,
        attempt.legalEntityId,
        attempt.dateStr,
        attempt.criteria,
        attempt.rows,
      );
      setConfirmPrint(null);
      busyRef.current = false;
      toast({
        title: saved.alreadySaved ? "Allerede registrert" : "Utskrift registrert",
        description: `${saved.itemCount} varelinjer lagret som grunnlag for ${attempt.dateStr}.`,
      });
    } catch (e) {
      console.error("Snapshot-lagring feilet", e);
      // Forsøket beholdes slik at brukeren kan prøve igjen mot SAMME grunnlag.
      toast({
        title: "Grunnlaget ble ikke lagret",
        description: "Neste korreksjonsliste ville fått feil sammenligning. Prøv igjen.",
        variant: "destructive",
      });
    } finally {
      setSavingBaseline(false);
    }
  }, [confirmPrint]);

  const dismissConfirm = useCallback(() => {
    setConfirmPrint(null);
    busyRef.current = false;
  }, []);

  return {
    printJob,
    confirmPrint,
    preparingPrint,
    savingBaseline,
    printBusy,
    startPrint,
    confirmPrinted,
    dismissConfirm,
  };
}
