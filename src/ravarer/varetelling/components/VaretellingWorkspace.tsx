import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useVtProbe } from "../hooks";
import { CountsPanel } from "./CountsPanel";
import { CountSession } from "./CountSession";
import { TemplatesPanel } from "./TemplatesPanel";
import { UncoveredPanel } from "./UncoveredPanel";
import { Loading, Notice } from "./shared";

export const VT_SECTIONS = [
  { id: "tellinger", label: "Tellinger" },
  { id: "maler", label: "Listemaler" },
  { id: "uten-liste", label: "Varer uten liste" },
  { id: "dagstelling", label: "Dagstelling" },
] as const;
export type VtSection = (typeof VT_SECTIONS)[number]["id"];
export const VT_PARAMS = ["vt", "telling"];

/**
 * Varetelling under Lager. `?vt=` velger inngang, `?telling=` åpner én telling.
 * «Dagstelling» er den eksisterende, uendrede tellingen med direkte bokføring.
 */
export function VaretellingWorkspace({ legacy }: { legacy: ReactNode }) {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("vt");
  const section: VtSection = VT_SECTIONS.some(s => s.id === raw) ? (raw as VtSection) : "tellinger";
  const countId = sp.get("telling");
  const probe = useVtProbe();
  const nav = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v == null) n.delete(k); else n.set(k, v); }
    setSp(n);
  };

  return (
    <div className="space-y-4">
      <nav aria-label="Varetelling" className="flex gap-1 overflow-x-auto border-b">
        {VT_SECTIONS.map(s => (
          <button key={s.id} type="button" aria-current={section === s.id ? "page" : undefined}
            onClick={() => nav({ vt: s.id === "tellinger" ? null : s.id, telling: null })}
            className={cn("min-h-[48px] whitespace-nowrap border-b-2 px-3 text-sm font-medium",
              section === s.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}>
            {s.label}
          </button>
        ))}
      </nav>
      {section === "dagstelling" ? legacy
        : probe.isLoading ? <Loading label="Kontrollerer tellesystemet …" />
        : probe.error ? <Notice tone="danger" title="Kunne ikke kontrollere tellesystemet." >Prøv igjen senere. Dagstellingen fungerer som før.</Notice>
        : probe.data === false ? (
          <Notice tone="warning" title="Det nye tellesystemet er ikke tatt i bruk ennå.">
            Listemaler, tellinger med frosne priser og registrering per liste blir tilgjengelig når databasedelen er godkjent og rullet ut.
            Ingenting kan lagres her før det. Bruk «Dagstelling» som før.
          </Notice>
        )
        : section === "maler" ? <TemplatesPanel />
        : section === "uten-liste" ? <UncoveredPanel />
        : countId ? <CountSession countId={countId} onBack={() => nav({ telling: null })} />
        : <CountsPanel onOpen={id => nav({ telling: id })} />}
    </div>
  );
}
