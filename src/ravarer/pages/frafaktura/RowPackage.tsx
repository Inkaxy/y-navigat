import { useId } from "react";
import { cn } from "@/lib/utils";
import { CONTENT_UNITS, PACKAGE_BADGE_LABEL, unitConflict, type ContentUnit, type PackageBadge, type PackageDraft, type PackageState } from "@/ravarer/lib/fraFaktura/newItems";

const TONE: Record<PackageBadge, string> = {
  sikker: "bg-success/10 text-success", kanskje: "bg-warning/15 text-warning", fyll_inn: "bg-destructive/10 text-destructive",
  ikke_vare: "bg-muted text-ink-secondary", kontroller: "bg-warning/15 text-warning", sjekk_tall: "bg-warning/15 text-warning",
};
const allowed = (base: string | null): readonly ContentUnit[] =>
  base === "kg" ? ["kg", "g"] : base === "l" ? ["l", "ml"] : base === "stk" ? ["stk"] : CONTENT_UNITS;

const kr = (n: number) => n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 3 });
const BASE_WORD: Record<string, string> = { kg: "kilo (kg)", l: "liter (l)", stk: "stykk (stk)" };

/**
 * «1 [beholder] = [mengde] [enhet]» med pris per fakturaenhet (kr/flaske), per stk og per grunnenhet (kr/l) og merke.
 * Tom mengde = rødt felt. `numbersNote` = regnestykket når tallene på linjen ikke går opp («Sjekk tallene»).
 */
export function RowPackage({ draft, onDraft, state, badge, price, baseUnit, disabled, unitPrices = [], numbersNote = null, onChangeBaseUnit, isNew = false }: {
  draft: PackageDraft; onDraft: (d: PackageDraft) => void; state: PackageState; badge: PackageBadge;
  price: number | null; baseUnit: string | null; disabled: boolean;
  unitPrices?: readonly { amount: number; unit: string }[]; numbersNote?: string | null;
  /** Åpner dialogen som retter varens grunnenhet (bare koblet vare med skriverett). */
  onChangeBaseUnit?: (to: "kg" | "l" | "stk") => void;
  isNew?: boolean;
}) {
  const id = useId();
  const unitOut = state.state === "valid" ? state.baseUnit : baseUnit ?? draft.unit;
  // Pris per fakturaenhet vises bare når pakningen er gyldig og enheten ikke er selve grunnenheten.
  const extra = state.state === "valid" ? unitPrices.filter((u) => u.unit !== unitOut) : [];
  const priceText = price == null ? null : [...extra.map((u) => `${kr(u.amount)} kr/${u.unit}`), `${kr(price)} kr/${unitOut}`].join(" · ");
  const missing = state.state === "empty";
  // Også fakturert direkte (kg på faktura mot stk-vare): da finnes ikke noe pakningsfelt, så valget må vises her.
  const conflict = baseUnit ? unitConflict(draft.unit, baseUnit) : null;
  const direct = draft.source === "direkte";
  const container = draft.container || "pakning";
  // Regnestykket i tre trinn: fakturapris → innhold → kalkylepris.
  const invoicePrice = state.state === "valid" ? unitPrices.find((u) => u.unit !== state.baseUnit) ?? null : null;
  const steps = state.state === "valid" && price != null ? {
    faktura: invoicePrice ? `${kr(invoicePrice.amount)} kr per ${invoicePrice.unit}` : null,
    innhold: state.direct ? `fakturert direkte i ${state.baseUnit}` : `1 ${container} = ${num(state.size)} ${state.unit}${state.unit !== state.baseUnit ? ` (${num(state.baseUnitsPerPackage)} ${state.baseUnit})` : ""}`,
    kalkyle: `${kr(price)} kr per ${state.baseUnit}`,
  } : null;
  return (
    <div className="space-y-1.5">
    <p className="text-caption text-ink-secondary">
      {baseUnit
        ? <>Varen regnes i <span className="font-semibold text-foreground">{BASE_WORD[baseUnit] ?? baseUnit}</span> i oppskrifter og kalkyler.</>
        : isNew ? <>Ny vare regnes i <span className="font-semibold text-foreground">{BASE_WORD[state.state === "valid" ? state.baseUnit : draft.unit === "g" ? "kg" : draft.unit === "ml" ? "l" : draft.unit] ?? draft.unit}</span> – styres av enheten du velger.</> : null}
    </p>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {draft.source === "direkte" ? (
        <span className="text-ink-secondary">Fakturert i {draft.unit}{conflict ? "" : " – ingen pakning trengs"}</span>
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
            {baseUnit && CONTENT_UNITS.filter((u) => !allowed(baseUnit).includes(u) && u !== draft.unit).map((u) => (
              <option key={u} value={u} disabled>{u} – passer ikke {baseUnit}-vare</option>
            ))}
          </select>
        </>
      )}
      {missing && <span className="font-semibold text-destructive">Mangler mengde</span>}
      {state.state === "invalid" && !(direct && conflict) && <span className="text-destructive">{state.reason}</span>}
      {!steps && priceText && <span className="font-semibold tabular-nums">{priceText}</span>}
      <span className={cn("rounded-full px-2 py-0.5 text-caption font-semibold", TONE[badge])}>{PACKAGE_BADGE_LABEL[badge]}</span>
      {numbersNote && <p className="basis-full text-caption text-warning">Sjekk tallene: {numbersNote}</p>}
    </div>
    {steps && (
      <ol aria-label="Slik regnes prisen" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/50 px-3 py-1.5 text-caption tabular-nums">
        {steps.faktura && <><li><span className="text-ink-secondary">Faktura:</span> <span className="font-semibold">{steps.faktura}</span></li><li aria-hidden className="text-ink-secondary">→</li></>}
        <li><span className="text-ink-secondary">Innhold:</span> <span className="font-semibold">{steps.innhold}</span></li>
        <li aria-hidden className="text-ink-secondary">→</li>
        <li><span className="text-ink-secondary">Kalkylepris:</span> <span className="font-semibold">{steps.kalkyle}</span></li>
      </ol>
    )}
    {conflict && (
      <div role="note" className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-caption">
        <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          {direct
            ? <>Fakturaen er i {draft.unit}, men varen regnes i {conflict.from}. Prisen regnes aldri om mellom {draft.unit} og {conflict.from}.{" "}
                {onChangeBaseUnit ? `Endre varen til ${conflict.to}, eller velg «Opprett som ny».` : `Velg «Opprett som ny» for en vare som regnes i ${conflict.to}.`}</>
            : <>Fakturaen oppgir {conflict.to === "kg" ? "vekt" : conflict.to === "l" ? "volum" : "antall"}, men varen regnes i {conflict.from}. Velg hva som stemmer:</>}
        </span>
        {conflict.from === "stk" && !direct && (
          <button type="button" disabled={disabled} onClick={() => onDraft({ ...draft, qty: "1", unit: "stk", conflict: false })}
            className="min-h-[44px] rounded-md border border-input bg-background px-3 font-semibold hover:bg-muted">Bruk 1 {container} = 1 stk</button>
        )}
        {onChangeBaseUnit && (
          <button type="button" disabled={disabled} onClick={() => onChangeBaseUnit(conflict.to)}
            className="min-h-[44px] rounded-md border border-input bg-background px-3 font-semibold hover:bg-muted">Endre varen til {conflict.to} …</button>
        )}
      </div>
    )}
    </div>
  );
}
