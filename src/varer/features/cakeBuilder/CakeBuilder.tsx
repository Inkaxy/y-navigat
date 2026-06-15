import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Cake, CheckCircle2, Info, Ban } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWizardConfig } from "./useWizardConfig";
import { usePriceCalculation } from "./usePriceCalculation";
import { StepHeader } from "./components/StepHeader";
import { StepNav } from "./components/StepNav";
import { SingleSelectStep } from "./steps/SingleSelectStep";
import { MultiSelectStep } from "./steps/MultiSelectStep";
import { TextInputStep } from "./steps/TextInputStep";
import { NumberInputStep } from "./steps/NumberInputStep";
import { CustomerStartStep, type CustomerMeta } from "./components/CustomerStartStep";
import { PaymentChoiceStep, type PaymentMode } from "./components/PaymentChoiceStep";
import type { CakeAccessoryLine, CakeConfig, CakeLabelPayload, CakeOrderLine, CakeResult, PriceBreakdown, WizardRule, WizardStep } from "./types";
import { evaluateRule } from "./ruleEvaluation";
import { supabase } from "@/integrations/supabase/client";

const VAT_TOGGLE_KEY = "varer_show_mva";

export interface CakeBuilderProps {
  categoryId: string;
  priceListId: string;
  legalEntityId: string;
  defaultPickupLocationId?: string | null;
  /** F1.3: pre-fill from existing config. Skeleton only — not implemented in F1.2. */
  initialConfig?: CakeConfig;
  showVatToggle?: boolean;
  onPriceChange?: (price: PriceBreakdown) => void;
  onComplete: (result: CakeResult) => void;
  onCancel: () => void;
  onConfigUpdated?: () => void;
  onStepChange?: (stepIndex: number, stepName: string) => void;
  theme?: "light" | "dark";
}

/**
 * The embeddable cake builder wizard. Designed to be used both inside the
 * Varer admin (preview) and as a standalone iframe in POS, Ordre, Kundeportal.
 */
export function CakeBuilder({
  categoryId,
  priceListId,
  legalEntityId,
  defaultPickupLocationId,
  initialConfig: _initialConfig,
  showVatToggle = true,
  onPriceChange,
  onComplete,
  onCancel,
  onConfigUpdated,
  onStepChange,
  theme: _theme,
}: CakeBuilderProps) {
  const {
    data: wizard,
    isLoading,
    isError,
    error,
  } = useWizardConfig({ categoryId, priceListId, onConfigUpdated });

  // VAT toggle persisted across sessions (consistent with /priser convention)
  const [showVat, setShowVat] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(VAT_TOGGLE_KEY) === "true";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VAT_TOGGLE_KEY, String(showVat));
    }
  }, [showVat]);

  const [phase, setPhase] = useState<"customer" | "step" | "summary" | "payment">(
    "customer",
  );
  const [stepIndex, setStepIndex] = useState(0);
  const isSummary = phase === "summary";
  const isCustomer = phase === "customer";
  const isPayment = phase === "payment";
  /** Confirmation state shown after the user clicks "Ferdig". Holds the result so we can show ordrebekreftelse. */
  const [confirmedResult, setConfirmedResult] = useState<CakeResult | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [customerMeta, setCustomerMeta] = useState<CustomerMeta>({
    pickup_date: null,
    pickup_location_id: defaultPickupLocationId ?? null,
    name: "",
    phone: "",
    email: "",
  });
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);
  // Per-step selections
  const [singleSelections, setSingleSelections] = useState<Record<string, string>>({});
  const [multiSelections, setMultiSelections] = useState<Record<string, string[]>>({});
  const [textInputs, setTextInputs] = useState<Record<string, string>>({});
  /** Set of rule ids the user has acknowledged via "continue" — suppresses re-display until selections change */
  const [dismissedRuleIds, setDismissedRuleIds] = useState<Set<string>>(new Set());

  const steps: WizardStep[] = wizard?.steps ?? [];
  const rules: WizardRule[] = wizard?.rules ?? [];
  const currentStep = steps[stepIndex];

  // Apply default_selected on first load
  useEffect(() => {
    if (!wizard) return;
    setSingleSelections((prev) => {
      const next = { ...prev };
      for (const step of wizard.steps) {
        if (step.selection_type === "single" && !next[step.id]) {
          const def = step.options.find((o) => o.default_selected);
          if (def) next[step.id] = def.option_id;
        }
      }
      return next;
    });
    setMultiSelections((prev) => {
      const next = { ...prev };
      for (const step of wizard.steps) {
        if (step.selection_type === "multi" && !next[step.id]) {
          const defs = step.options.filter((o) => o.default_selected).map((o) => o.option_id);
          if (defs.length > 0) next[step.id] = defs;
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard?.category?.id]);

  // Prune selections that no longer exist after a Realtime refetch
  useEffect(() => {
    if (!wizard) return;
    const validOptionIds = new Set<string>();
    for (const step of wizard.steps) {
      for (const opt of step.options) validOptionIds.add(opt.option_id);
    }
    let pruned = false;
    setSingleSelections((prev) => {
      const next: Record<string, string> = {};
      for (const [stepId, optId] of Object.entries(prev)) {
        if (validOptionIds.has(optId)) next[stepId] = optId;
        else pruned = true;
      }
      return next;
    });
    setMultiSelections((prev) => {
      const next: Record<string, string[]> = {};
      for (const [stepId, optIds] of Object.entries(prev)) {
        const filtered = optIds.filter((id) => validOptionIds.has(id));
        if (filtered.length !== optIds.length) pruned = true;
        if (filtered.length > 0) next[stepId] = filtered;
      }
      return next;
    });
    if (pruned) {
      toast.warning("Et valg er ikke lenger tilgjengelig", {
        description: "Sjekk dine valg på nytt.",
      });
    }
    // Clamp stepIndex if steps shrank
    if (stepIndex >= wizard.steps.length && wizard.steps.length > 0) {
      setStepIndex(wizard.steps.length - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard]);

  // Flat list of currently-selected option ids for pricing + rule eval
  const selectedOptionIds = useMemo(() => {
    const ids: string[] = [];
    for (const step of steps) {
      if (step.selection_type === "single") {
        const sel = singleSelections[step.id];
        if (sel) ids.push(sel);
      } else if (step.selection_type === "multi") {
        const sel = multiSelections[step.id] ?? [];
        ids.push(...sel);
      }
    }
    return ids;
  }, [steps, singleSelections, multiSelections]);

  const { price, isCalculating } = usePriceCalculation({
    categoryId,
    priceListId,
    selectedOptionIds,
  });

  useEffect(() => {
    if (price && onPriceChange) onPriceChange(price);
  }, [price, onPriceChange]);

  useEffect(() => {
    if (currentStep && onStepChange) onStepChange(stepIndex, currentStep.name);
  }, [stepIndex, currentStep, onStepChange]);

  // Build a set of all "rule-match ids" for currently selected options.
  // We accept ANY of: option_id, product_id, or `custom:<option_id>`, so the
  // rule trigger matches no matter which form was stored on the rule.
  const selectedRuleIds = useMemo(() => {
    const set = new Set<string>();
    for (const step of steps) {
      for (const opt of step.options) {
        const isSelected =
          (step.selection_type === "single" && singleSelections[step.id] === opt.option_id) ||
          (step.selection_type === "multi" && (multiSelections[step.id] ?? []).includes(opt.option_id));
        if (!isSelected) continue;
        set.add(opt.option_id);
        set.add(`custom:${opt.option_id}`);
        if (opt.product_id) set.add(opt.product_id);
      }
    }
    return set;
  }, [steps, singleSelections, multiSelections]);

  // Evaluate compatibility rules (client-side) against currently selected products
  const triggeredRules = useMemo(() => {
    if (rules.length === 0) return [];
    return rules.filter((r) =>
      evaluateRule({
        rule_type: r.rule_type,
        trigger_product_ids: r.trigger_product_ids,
        selectedIds: selectedRuleIds,
      }),
    );
  }, [rules, selectedRuleIds]);

  // Drop dismissed-acknowledgements for rules som ikke lenger er trigget,
  // slik at samme regel vises på nytt om triggeren oppstår igjen senere.
  // Vi BEHOLDER dismissed for regler som fortsatt er trigget (ellers ville
  // popup re-vises i samme render-syklus rett etter en "remove_product"-action
  // før React-batched state-oppdateringer rakk å fjerne triggeren).
  const triggeredRuleIds = useMemo(
    () => new Set(triggeredRules.map((r) => r.id)),
    [triggeredRules],
  );
  useEffect(() => {
    setDismissedRuleIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (triggeredRuleIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [triggeredRuleIds]);

  // Rules that are still showing (not dismissed by the user).
  // `block`-rules can NEVER be dismissed — they must be resolved by changing selections.
  const activeRules = useMemo(
    () =>
      triggeredRules.filter((r) => r.severity === "block" || !dismissedRuleIds.has(r.id)),
    [triggeredRules, dismissedRuleIds],
  );

  const blockingRule = activeRules.find((r) => r.severity === "block");

  // Show the highest-priority active rule as a popup (block > warning).
  // Info-rules vises kun inline (ikke popup) for å unngå støy.
  const popupRule = useMemo(() => {
    const order = { block: 0, warning: 1, info: 2 } as const;
    return (
      [...activeRules]
        .filter((r) => r.severity !== "info")
        .sort((a, b) => order[a.severity] - order[b.severity])[0] ?? null
    );
  }, [activeRules]);

  /** Handle a click on a rule's response_options button. */
  const handleRuleAction = (rule: WizardRule, opt: NonNullable<WizardRule["response_options"]>[number]) => {
    const action = opt.action ?? "continue";
    if (action === "remove_product" && opt.remove_product_id) {
      const target = opt.remove_product_id;
      const matchingOptionIds = new Set<string>();
      for (const step of steps) {
        for (const o of step.options) {
          if (
            target === o.option_id ||
            target === `custom:${o.option_id}` ||
            (o.product_id && target === o.product_id)
          ) {
            matchingOptionIds.add(o.option_id);
          }
        }
      }
      if (matchingOptionIds.size === 0) {
        toast.error("Fant ikke produktet som skulle fjernes.");
        return;
      }
      // Lukk popupen umiddelbart for denne regelen — re-evalueringen
      // av selections vil enten holde den lukket (regel ikke lenger trigget)
      // eller åpne den igjen (hvis fortsatt trigget) i samme render-syklus.
      setDismissedRuleIds((prev) => new Set(prev).add(rule.id));
      setSingleSelections((prev) => {
        const next = { ...prev };
        for (const [stepId, oid] of Object.entries(prev)) {
          if (matchingOptionIds.has(oid)) delete next[stepId];
        }
        return next;
      });
      setMultiSelections((prev) => {
        const next: Record<string, string[]> = {};
        for (const [stepId, oids] of Object.entries(prev)) {
          next[stepId] = oids.filter((x) => !matchingOptionIds.has(x));
        }
        return next;
      });
      toast.success(`"${opt.label}" — produkt fjernet.`);
      return;
    }
    if (action === "back") {
      setStepIndex((i) => Math.max(0, i - 1));
      setDismissedRuleIds((prev) => new Set(prev).add(rule.id));
      return;
    }
    if (action === "block") {
      toast.warning("Endre valg for å fortsette.");
      return;
    }
    // "continue" (eller ukjent trygt fallback)
    if (rule.severity === "block") {
      toast.warning("Denne regelen kan ikke ignoreres — endre valg.");
      return;
    }
    setDismissedRuleIds((prev) => new Set(prev).add(rule.id));
  };

  // Per-step validation
  const stepValidation = useMemo(() => {
    if (!currentStep) return null;
    if (currentStep.selection_type === "single") {
      if (currentStep.required && !singleSelections[currentStep.id]) {
        return "Du må velge ett alternativ.";
      }
    } else if (currentStep.selection_type === "multi") {
      const sel = multiSelections[currentStep.id] ?? [];
      if (currentStep.required && sel.length === 0) return "Du må velge minst ett alternativ.";
      if (currentStep.min_selections && sel.length < currentStep.min_selections) {
        return `Velg minst ${currentStep.min_selections}.`;
      }
      if (currentStep.max_selections && sel.length > currentStep.max_selections) {
        return `Velg maks ${currentStep.max_selections}.`;
      }
    } else if (currentStep.selection_type === "text") {
      const v = (textInputs[currentStep.id] ?? "").trim();
      if (currentStep.required && !v) return "Du må fylle inn tekst.";
      if (currentStep.max_selections && v.length > currentStep.max_selections) {
        return `Maks ${currentStep.max_selections} tegn.`;
      }
    } else if (currentStep.selection_type === "number") {
      const raw = (textInputs[currentStep.id] ?? "").trim();
      if (currentStep.required && !raw) return "Du må fylle inn et tall.";
      if (raw) {
        const n = Number(raw);
        if (!Number.isFinite(n)) return "Ugyldig tall.";
        if (currentStep.min_selections != null && n < currentStep.min_selections) {
          return `Min: ${currentStep.min_selections}`;
        }
        if (currentStep.max_selections != null && n > currentStep.max_selections) {
          return `Maks: ${currentStep.max_selections}`;
        }
      }
    }
    return null;
  }, [currentStep, singleSelections, multiSelections, textInputs]);

  const canProceed = !stepValidation && !blockingRule;

  // ─── Render states ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="border-b p-4">
          <Skeleton className="h-6 w-1/3" />
        </div>
        <div className="flex-1 p-4 space-y-3">
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !wizard?.category) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive mb-3" />
        <h2 className="text-lg font-semibold mb-1">Kunne ikke laste kakebygger</h2>
        <p className="text-sm text-muted-foreground">
          {(error as Error | undefined)?.message ?? "Kategorien finnes ikke eller er ikke aktiv."}
        </p>
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <Cake className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <h2 className="text-lg font-semibold mb-1">{wizard.category.name}</h2>
        <p className="text-sm text-muted-foreground">Denne kake-typen er ikke konfigurert ennå.</p>
      </div>
    );
  }

  /**
 * Bygger selections-arrayet (input til både RPC og CakeResult).
 */
  const buildSelections = (): CakeResult["selections"] => {
    return steps.map((s) => {
      if (s.selection_type === "single") {
        return {
          step_id: s.id,
          step_name: s.name,
          selection_type: s.selection_type,
          option_ids: singleSelections[s.id] ? [singleSelections[s.id]] : [],
        };
      }
      if (s.selection_type === "multi") {
        return {
          step_id: s.id,
          step_name: s.name,
          selection_type: s.selection_type,
          option_ids: multiSelections[s.id] ?? [],
        };
      }
      if (s.selection_type === "text") {
        return {
          step_id: s.id,
          step_name: s.name,
          selection_type: s.selection_type,
          option_ids: [],
          text: textInputs[s.id] ?? "",
        };
      }
      return {
        step_id: s.id,
        step_name: s.name,
        selection_type: s.selection_type,
        option_ids: [],
        number: textInputs[s.id] ? Number(textInputs[s.id]) : undefined,
      };
    });
  };

  /** Klikk på "Ferdig" på oppsummeringen → kall server-RPC, vis bekreftelse-skjerm */
  const handleConfirmStep = async () => {
    if (blockingRule) {
      toast.warning("Du må løse blokkerende varsler først.");
      return;
    }
    if (!price || !wizard?.category) return;
    setIsFinalizing(true);
    try {
      const selections = buildSelections();
      const { data, error } = await supabase.rpc("build_cake_order_line", {
        p_category_id: wizard.category.id,
        p_price_list_id: priceListId,
        p_selections: selections as unknown as never,
      });
      if (error) throw error;
      const payload = data as unknown as {
        order_line: CakeOrderLine;
        accessory_lines: CakeAccessoryLine[];
        label_payload: CakeLabelPayload;
        price_breakdown: PriceBreakdown;
      };
      if (!payload?.order_line || !payload?.label_payload) {
        throw new Error("Ufullstendig svar fra serveren.");
      }
      const result: CakeResult = {
        category_id: wizard.category.id,
        category_name: wizard.category.name,
        price_list_id: priceListId,
        selections,
        total_ex_mva: payload.price_breakdown?.total_ex_mva ?? price.total_ex_mva,
        total_inc_mva: payload.price_breakdown?.total_inc_mva ?? price.total_inc_mva,
        price_breakdown: payload.price_breakdown ?? price,
        order_line: payload.order_line,
        accessory_lines: payload.accessory_lines ?? [],
        label_payload: payload.label_payload,
      };
      setConfirmedResult(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ukjent feil";
      toast.error("Kunne ikke bygge ordrelinje", { description: msg });
    } finally {
      setIsFinalizing(false);
    }
  };

  /** Klikk på "Bekreft bestilling" på bekreftelses-skjermen */
  const handleFinalConfirm = () => {
    if (!confirmedResult) return;
    onComplete(confirmedResult);
  };

  // ─── Build a human-readable summary of all selections (for the confirm screen) ────
  const summaryLines = steps.map((s) => {
    const lookupName = (oid: string) => {
      const o = s.options.find((x) => x.option_id === oid);
      if (!o) return oid;
      return o.display_name ?? o.custom_name ?? "Uten navn";
    };
    if (s.selection_type === "single") {
      const oid = singleSelections[s.id];
      return { step: s.name, value: oid ? lookupName(oid) : "—" };
    }
    if (s.selection_type === "multi") {
      const oids = multiSelections[s.id] ?? [];
      return { step: s.name, value: oids.length ? oids.map(lookupName).join(", ") : "—" };
    }
    if (s.selection_type === "text") {
      return { step: s.name, value: textInputs[s.id]?.trim() || "—" };
    }
    return { step: s.name, value: textInputs[s.id]?.trim() || "—" };
  });

  // ─── Bekreftelses-skjerm etter "Ferdig" ──────────────────────────────────
  if (confirmedResult) {
    const lookupName = (stepId: string, oid: string) => {
      const s = steps.find((x) => x.id === stepId);
      const o = s?.options.find((x) => x.option_id === oid);
      if (!o) return oid;
      return o.display_name ?? o.custom_name ?? "Uten navn";
    };
    const lp = confirmedResult.label_payload;
    const ol = confirmedResult.order_line;
    const labelEntries: Array<[string, string | null]> = [
      ["Kunde", lp.customer_name],
      ["Hentested", lp.pickup_location],
      ["Dato", lp.pickup_date],
      ["Tur", lp.pickup_tour],
      ["Tid", lp.pickup_time],
      ["Mottaker", lp.recipient],
      ["Tekst på kake", lp.cake_text],
      ["Merknad", lp.note],
    ];
    const filledLabelEntries = labelEntries.filter(([, v]) => v && v.trim().length > 0);
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="border-b bg-card px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <div>
            <h1 className="text-lg font-semibold">Bestilling bekreftet</h1>
            <p className="text-xs text-muted-foreground">
              Gjennomgå bestillingen før den sendes inn.
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-md border-2 border-app/30 bg-app/5 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Varenummer (til produksjon)
                </div>
                <div className="text-2xl font-bold tabular-nums text-app-dark">
                  #{ol.display_number ?? "—"}
                </div>
                <div className="text-sm text-foreground">{ol.display_name}</div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Total inkl. mva
                </div>
                <div className="text-xl font-bold tabular-nums">
                  {confirmedResult.total_inc_mva.toFixed(2)} kr
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-md border bg-card">
            <div className="px-4 py-2 border-b text-xs uppercase tracking-wide text-muted-foreground">
              Etikett (forhåndsvisning) — skrives ut i Produksjon
            </div>
            <div className="px-4 py-3 space-y-2">
              <div className="text-sm font-semibold">
                {lp.display_name}{" "}
                <span className="text-muted-foreground font-normal">
                  #{lp.display_number ?? "—"}
                </span>
              </div>
              {filledLabelEntries.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">
                  Ingen etikett-felt fylt ut. Konfigurer "Etikett-felt" på tekst-/tall-stegene i Kakebygger-admin.
                </div>
              ) : (
                <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1 text-sm">
                  {filledLabelEntries.map(([k, v]) => (
                    <div key={k} className="contents">
                      <div className="text-muted-foreground">{k}</div>
                      <div className="text-foreground">{v}</div>
                    </div>
                  ))}
                </div>
              )}
              {lp.components.length > 0 && (
                <div className="pt-2 border-t mt-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    Inneholder
                  </div>
                  <ul className="text-sm space-y-0.5">
                    {lp.components.map((c, i) => (
                      <li key={i} className="flex items-baseline gap-2">
                        <span className="text-xs uppercase text-muted-foreground min-w-[70px]">
                          {c.role}
                        </span>
                        <span>
                          {c.display_name}
                          {c.display_number != null && (
                            <span className="text-muted-foreground"> #{c.display_number}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {confirmedResult.accessory_lines.length > 0 && (
            <div className="rounded-md border bg-card">
              <div className="px-4 py-2 border-b text-xs uppercase tracking-wide text-muted-foreground">
                Tilbehør-linjer (kun for fakturering)
              </div>
              <div className="divide-y">
                {confirmedResult.accessory_lines.map((al, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                    <div>
                      <span className="text-muted-foreground tabular-nums mr-2">
                        #{al.display_number ?? "—"}
                      </span>
                      {al.display_name}
                    </div>
                    <div className="tabular-nums">{al.unit_price_excl_vat.toFixed(2)} kr</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-md border bg-card">
            <div className="px-4 py-3 border-b">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Kategori
              </div>
              <div className="text-base font-semibold">{confirmedResult.category_name}</div>
            </div>
            <div className="divide-y">
              {confirmedResult.selections.map((sel) => {
                let value = "—";
                if (sel.selection_type === "single" || sel.selection_type === "multi") {
                  value = sel.option_ids.length
                    ? sel.option_ids.map((oid) => lookupName(sel.step_id, oid)).join(", ")
                    : "—";
                } else if (sel.selection_type === "text") {
                  value = sel.text?.trim() || "—";
                } else if (sel.selection_type === "number") {
                  value = sel.number != null ? String(sel.number) : "—";
                }
                return (
                  <div key={sel.step_id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="text-sm font-medium text-muted-foreground min-w-[140px]">
                      {sel.step_name}
                    </div>
                    <div className="text-sm text-foreground text-right flex-1">{value}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border bg-card">
            <div className="px-4 py-2 border-b text-xs uppercase tracking-wide text-muted-foreground">
              Prislinjer
            </div>
            <div className="divide-y">
              <div className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-muted-foreground">Grunnpris</span>
                <span>{confirmedResult.price_breakdown.base_price.toFixed(2)} kr</span>
              </div>
              {confirmedResult.price_breakdown.lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>{l.display_name}</span>
                  <span>{l.price.toFixed(2)} kr</span>
                </div>
              ))}
              {confirmedResult.price_breakdown.step_overages.map((o, i) => (
                <div key={`o-${i}`} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {o.overage_count}× ekstra à {o.extra_unit_price.toFixed(2)} kr
                  </span>
                  <span>{o.overage_total.toFixed(2)} kr</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 px-4 py-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Sum eks. mva</span>
              <span className="font-medium">{confirmedResult.total_ex_mva.toFixed(2)} kr</span>
            </div>
            <div className="flex justify-between text-base">
              <span className="font-semibold">Total inkl. mva</span>
              <span className="font-bold">{confirmedResult.total_inc_mva.toFixed(2)} kr</span>
            </div>
          </div>
        </div>
        <div className="border-t bg-card px-4 py-3 flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirmedResult(null)}>
            Tilbake til oppsummering
          </Button>
          <Button size="sm" onClick={handleFinalConfirm}>
            Bekreft bestilling
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <StepHeader
        categoryName={wizard.category.name}
        stepIndex={isSummary ? steps.length : stepIndex}
        totalSteps={steps.length}
        totalExMva={price?.total_ex_mva ?? wizard.category.base_price ?? 0}
        totalIncMva={price?.total_inc_mva ?? wizard.category.base_price ?? 0}
        showVat={showVat}
        onToggleVat={setShowVat}
        showVatToggle={showVatToggle}
        isCalculating={isCalculating}
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isSummary ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Oppsummering</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Sjekk at alt stemmer før du bekrefter bestillingen.
              </p>
            </div>

            {activeRules.length > 0 && (
              <RuleList rules={activeRules} onAction={handleRuleAction} />
            )}

            <div className="rounded-md border divide-y bg-card">
              {summaryLines.map((line, i) => (
                <div key={i} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="text-sm font-medium text-muted-foreground min-w-[120px]">
                    {line.step}
                  </div>
                  <div className="text-sm text-foreground text-right flex-1">{line.value}</div>
                </div>
              ))}
            </div>
            {price && (
              <div className="rounded-md border bg-muted/30 px-4 py-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sum eks. mva</span>
                  <span className="font-medium">{price.total_ex_mva.toFixed(2)} kr</span>
                </div>
                <div className="flex justify-between text-base">
                  <span className="font-semibold">Total inkl. mva</span>
                  <span className="font-bold">{price.total_inc_mva.toFixed(2)} kr</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-xl font-semibold">{currentStep.name}</h2>
              {currentStep.description && (
                <p className="text-sm text-muted-foreground mt-1">{currentStep.description}</p>
              )}
            </div>

            {activeRules.length > 0 && (
              <RuleList rules={activeRules} onAction={handleRuleAction} />
            )}

            {currentStep.selection_type === "single" && (
              <SingleSelectStep
                step={currentStep}
                selectedOptionId={singleSelections[currentStep.id] ?? null}
                onSelect={(optId) =>
                  setSingleSelections((prev) => ({ ...prev, [currentStep.id]: optId }))
                }
                showVat={showVat}
              />
            )}
            {currentStep.selection_type === "multi" && (
              <MultiSelectStep
                step={currentStep}
                selectedOptionIds={multiSelections[currentStep.id] ?? []}
                onToggle={(optId) =>
                  setMultiSelections((prev) => {
                    const cur = prev[currentStep.id] ?? [];
                    const next = cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId];
                    return { ...prev, [currentStep.id]: next };
                  })
                }
                showVat={showVat}
              />
            )}
            {currentStep.selection_type === "text" && (
              <TextInputStep
                step={currentStep}
                value={textInputs[currentStep.id] ?? ""}
                onChange={(v) => setTextInputs((prev) => ({ ...prev, [currentStep.id]: v }))}
              />
            )}
            {currentStep.selection_type === "number" && (
              <NumberInputStep
                step={currentStep}
                value={textInputs[currentStep.id] ?? ""}
                onChange={(v) => setTextInputs((prev) => ({ ...prev, [currentStep.id]: v }))}
              />
            )}
          </>
        )}
      </div>

      <StepNav
        isFirst={!isSummary && stepIndex === 0}
        isLast={isSummary}
        canProceed={isSummary ? Boolean(price) && !blockingRule : canProceed}
        onBack={() => {
          if (isSummary) setIsSummary(false);
          else setStepIndex((i) => Math.max(0, i - 1));
        }}
        onNext={() => {
          if (stepIndex === steps.length - 1) setIsSummary(true);
          else setStepIndex((i) => Math.min(steps.length - 1, i + 1));
        }}
        onComplete={handleConfirmStep}
        onCancel={onCancel}
        isCompleting={isFinalizing}
        validationMessage={
          isSummary
            ? blockingRule
              ? blockingRule.message
              : null
            : (stepValidation ?? (blockingRule ? blockingRule.message : null))
        }
      />

      {/* Popup-dialog for høyest-prioritet aktive varsel/blokk-regel */}
      <Dialog
        open={popupRule !== null}
        onOpenChange={(open) => {
          if (!open && popupRule && popupRule.severity !== "block") {
            setDismissedRuleIds((prev) => new Set(prev).add(popupRule.id));
          }
        }}
      >
        <DialogContent
          className="max-w-md"
          onEscapeKeyDown={(e) => {
            if (popupRule?.severity === "block") e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (popupRule?.severity === "block") e.preventDefault();
          }}
        >
          {popupRule && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {popupRule.severity === "block" ? (
                    <Ban className="h-5 w-5 text-destructive" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-warning" />
                  )}
                  {popupRule.name || (popupRule.severity === "block" ? "Blokkert" : "Advarsel")}
                </DialogTitle>
                <DialogDescription className="text-foreground/90 pt-2">
                  {popupRule.message}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-wrap gap-2">
                {(popupRule.response_options ?? []).length === 0 ? (
                  <Button
                    onClick={() => {
                      if (popupRule.severity !== "block") {
                        setDismissedRuleIds((prev) => new Set(prev).add(popupRule.id));
                      } else {
                        toast.warning("Endre valg for å fortsette.");
                      }
                    }}
                  >
                    OK
                  </Button>
                ) : (
                  (popupRule.response_options ?? []).map((opt, idx) => (
                    <Button
                      key={opt.id ?? idx}
                      variant={opt.is_primary ? "default" : "outline"}
                      onClick={() => handleRuleAction(popupRule, opt)}
                    >
                      {opt.label}
                    </Button>
                  ))
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Inline-varsel-liste (vises både i steg og oppsummering som kontekst) ──
function RuleList({
  rules,
  onAction,
}: {
  rules: WizardRule[];
  onAction: (rule: WizardRule, opt: NonNullable<WizardRule["response_options"]>[number]) => void;
}) {
  return (
    <div className="space-y-2">
      {rules.map((r) => {
        const Icon = r.severity === "block" ? Ban : r.severity === "warning" ? AlertTriangle : Info;
        const cls =
          r.severity === "block"
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : r.severity === "warning"
              ? "border-warning/30 bg-warning/10 text-foreground"
              : "border-app/20 bg-app/5 text-app-dark";
        const opts = r.response_options ?? [];
        return (
          <div
            key={r.id}
            className={cn("flex flex-col gap-2 rounded-md border px-3 py-2 text-xs", cls)}
          >
            <div className="flex items-start gap-2">
              <Icon className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1 font-medium">{r.message}</div>
            </div>
            {opts.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-6">
                {opts.map((opt, idx) => (
                  <Button
                    key={opt.id ?? idx}
                    size="sm"
                    variant={opt.is_primary ? "default" : "outline"}
                    onClick={() => onAction(r, opt)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
