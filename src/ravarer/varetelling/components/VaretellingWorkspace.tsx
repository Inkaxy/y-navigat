import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useVtProbe } from "../hooks";
import { CountsPanel } from "./CountsPanel";
import { CountSession } from "./CountSession";
import { PrintSheets } from "./PrintSheets";
import { TemplatesPanel } from "./TemplatesPanel";
import { UncoveredPanel } from "./UncoveredPanel";
import { CalendarPanel, MyListsPanel } from "./PlanningPanels";
import { osloToday } from "@/lib/osloDate";
import { Loading, Notice } from "./shared";

export const VT_SECTIONS = [
  { id: "tellinger", label: "Tellinger" },
  { id: "mine", label: "Mine lister" },
  { id: "kalender", label: "Kalender" },
  { id: "maler", label: "Listemaler" },
  { id: "uten-liste", label: "Varer uten liste" },
  { id: "dagstelling", label: "Dagstelling" },
] as const;
export type VtSection = (typeof VT_SECTIONS)[number]["id"];
export const VT_PARAMS = ["vt", "telling", "liste", "utskrift", "side", "v"];

/**
 * Varetelling under Lager. `?vt=` velger inngang, `?telling=` åpner én telling, `?liste=` én telleliste
 * (QR-lenker), `?utskrift=blank|rapport` åpner utskrift. «Dagstelling» er den eksisterende, uendrede tellingen.
 */
export function VaretellingWorkspace({ legacy }: { legacy: ReactNode }) {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("vt");
  const section: VtSection = VT_SECTIONS.find(s => s.id === raw)?.id ?? "tellinger";
  const countId = sp.get("telling");
  const listId = sp.get("liste");
  const printRaw = sp.get("utskrift");
  const print = printRaw === "blank" || printRaw === "rapport" ? printRaw : null;
  const probe = useVtProbe();
  const nav = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v == null) n.delete(k); else n.set(k, v); }
    setSp(n);
  };

  return (
    <div className="space-y-4">
      <nav aria-label="Varetelling" className="flex gap-1 overflow-x-auto border-b print:hidden">
        {VT_SECTIONS.map(s => (
          <button key={s.id} type="button" aria-current={section === s.id ? "page" : undefined}
            onClick={() => nav({ vt: s.id === "tellinger" ? null : s.id, telling: null, liste: null, utskrift: null, side: null, v: null })}
            className={cn("min-h-[48px] whitespace-nowrap border-b-2 px-3 text-sm font-medium",
              section === s.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}>
            {s.label}
          </button>
        ))}
      </nav>
      {section === "dagstelling" ? legacy
        : probe.isLoading ? <Loading label="Kontrollerer tellesystemet …" />
        : probe.error ? <Notice tone="danger" title="Kunne ikke kontrollere tellesystemet.">Prøv igjen senere. Dagstellingen fungerer som før.</Notice>
        : probe.data === "missing" ? (
          <Notice tone="warning" title="Det nye tellesystemet er ikke tatt i bruk ennå.">
            Listemaler, tellinger med frosne priser og registrering per liste blir tilgjengelig når databasedelen er godkjent og rullet ut.
            Ingenting kan lagres her før det. Bruk «Dagstelling» som før.
          </Notice>
        )
        : probe.data === "outdated" ? (
          <Notice tone="warning" title="Databasedelen har en annen versjon enn denne skjermen.">
            Ingenting kan lagres her før versjonene stemmer. Bruk «Dagstelling» som før.
          </Notice>
        )
        : section === "mine" ? <MyListsPanel onOpen={(c, l) => nav({ vt: null, telling: c, liste: l })} />
        : section === "kalender" ? <CalendarPanel today={osloToday()} onOpen={c => nav({ vt: null, telling: c })} />
        : section === "maler" ? <TemplatesPanel />
        : section === "uten-liste" ? <UncoveredPanel />
        : countId && print ? <PrintSheets countId={countId} kind={print} listId={listId} onBack={() => nav({ utskrift: null })} />
        : countId ? <CountSession countId={countId} listId={listId} onBack={() => nav({ telling: null, liste: null, side: null, v: null })}
            onList={id => nav({ liste: id, side: null, v: null })} onPrint={k => nav({ utskrift: k })} />
        : <CountsPanel onOpen={id => nav({ telling: id })} />}
    </div>
  );
}
