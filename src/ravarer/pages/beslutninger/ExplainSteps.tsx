import { useState } from "react";
import { cn } from "@/lib/utils";

const KEY = "nbhub:beslutninger:skjul-forklaring";
const STEPS = [
  { t: "1 Faktura inn", d: "Hentes og leses automatisk" },
  { t: "2 Du svarer", d: "Bare det systemet ikke vet" },
  { t: "3 Riktig kost", d: "Per råvare, eldste kjøp først" },
  { t: "4 Handelsvarer", d: "Innpris + påslag = salgspris" },
  { t: "5 Prisgrunnlag", d: "Hvorfor prisen må opp" },
];

function initial(): boolean {
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Forklaringsstripen over køen; kan skjules (huskes i nettleseren). */
export function ExplainSteps() {
  const [hidden, setHidden] = useState(initial);
  const toggle = () => {
    const v = !hidden;
    setHidden(v);
    try { window.localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* lagring utilgjengelig: bare denne økten */ }
  };
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" onClick={toggle} className="min-h-[44px] text-body font-semibold text-primary underline-offset-2 hover:underline sm:min-h-0">
          {hidden ? "Vis forklaring" : "Skjul forklaring"}
        </button>
      </div>
      {!hidden && (
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.t} className={cn("rounded-xl border bg-card px-3 py-2", i === 1 ? "border-primary bg-accent" : "border-line-subtle")}>
              <p className="text-body font-semibold">{s.t}</p>
              <p className="text-caption text-ink-secondary">{s.d}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
