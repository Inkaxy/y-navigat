import { useId } from "react";
import { cn } from "@/lib/utils";
import { CONTENT_UNITS, PACKAGE_BADGE_LABEL, type ContentUnit, type PackageBadge, type PackageDraft, type PackageState } from "@/ravarer/lib/fraFaktura/newItems";

const TONE: Record<PackageBadge, string> = {
  sikker: "bg-success/10 text-success", kanskje: "bg-warning/15 text-warning", fyll_inn: "bg-destructive/10 text-destructive",
  ikke_vare: "bg-muted text-ink-secondary", kontroller: "bg-warning/15 text-warning", sjekk_tall: "bg-warning/15 text-warning",
};
const allowed = (base: string | null): readonly ContentUnit[] =>
  base === "kg" ? ["kg", "g"] : base === "l" ? ["l", "ml"] : base === "stk" ? ["stk"] : CONTENT_UNITS;

const kr = (n: number) => n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * «1 [beholder] = [mengde] [enhet]» med pris per fakturaenhet (kr/flaske), per stk og per grunnenhet (kr/l) og merke.
 * Tom mengde = rødt felt. `numbersNote` = regnestykket når tallene på linjen ikke går opp («Sjekk tallene»).
 */
export function RowPackage({ draft, onDraft, state, badge, price, baseUnit, disabled, unitPrices = [], numbersNote = null }: {
  draft: PackageDraft; onDraft: (d: PackageDraft) => void; state: PackageState; badge: PackageBadge;
  price: number | null; baseUnit: string | null; disabled: boolean;
  unitPrices?: readonly { amount: number; unit: string }[]; numbersNote?: string | null;
}) {
  const id = useId();
  const unitOut = state.state === "valid" ? state.baseUnit : baseUnit ?? draft.unit;
  // Pris per fakturaenhet vises bare når pakningen er gyldig og enheten ikke er selve grunnenheten.
  const extra = state.state === "valid" ? unitPrices.filter((u) => u.unit !== unitOut) : [];
  const priceText = price == null ? null : [...extra.map((u) => `${kr(u.amount)} kr/${u.unit}`), `${kr(price)} kr/${unitOut}`].join(" · ");
  const missing = state.state === "empty";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {draft.source === "direkte" ? (
        <span className="text-ink-secondary">Fakturert i {draft.unit} – ingen pakning trengs</span>
      ) : (
        <>
          <label htmlFor={`${id}-q`} className="text-ink-secondary">1 {draft.container || "pakning"} =</label>
          <input id={`${id}-q`} inputMode="decimal" value={draft.qty} disabled={disabled} aria-invalid={missing || state.state === "invalid"}
            onChange={(e) => onDraft({ ...draft, qty: e.target.value, conflict: false })}
            className={cn("h-11 w-24 rounded-md border bg-background px-3 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              missing || state.state === "invalid" ? "border-destructive" : "border-input")} />
          <label htmlFor={`${id}-u`} className="sr-only">Enhet</label>
          <select id={`${id}-u`} value={draft.unit} disabled={disabled} onChange={(e) => { const u = CONTENT_UNITS.find((x) => x === e.target.value); if (u) onDraft({ ...draft, unit: u, conflict: false }); }}
            className="h-11 rounded-md border border-input bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {[...new Set([...allowed(baseUnit), draft.unit])].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </>
      )}
      {missing && <span className="font-semibold text-destructive">Mangler mengde</span>}
      {state.state === "invalid" && <span className="text-destructive">{state.reason}</span>}
      {priceText && <span className="font-semibold tabular-nums">{priceText}</span>}
      <span className={cn("rounded-full px-2 py-0.5 text-caption font-semibold", TONE[badge])}>{PACKAGE_BADGE_LABEL[badge]}</span>
      {numbersNote && <p className="basis-full text-caption text-warning">Sjekk tallene: {numbersNote}</p>}
    </div>
  );
}
