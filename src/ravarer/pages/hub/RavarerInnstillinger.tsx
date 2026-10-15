import { Suspense, useEffect } from "react";
import { lazyWithReload as lazy } from "@/lib/lazyWithReload";
import { Link, useSearchParams } from "react-router-dom";
import { useGuardedNavigate } from "@/providers/UnsavedGuardProvider";
import { QueryEmptyState, QueryLoadingState } from "@/components/common/QueryState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { paths, type InnstillingSeksjon } from "@/ravarer/lib/paths";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { cn } from "@/lib/utils";
import { RAVARER_EYEBROW } from "./hubTabs";

const MatchToleranser = lazy(() => import("@/ravarer/pages/innstillinger/MatchToleranser"));
const Tripletex = lazy(() => import("@/ravarer/pages/innstillinger/TripletexSettings"));
const Kategorier = lazy(() => import("@/ravarer/pages/innstillinger/KategorierSettings"));
const AiTjenester = lazy(() => import("@/ravarer/pages/innstillinger/AiServicesSettings"));

type Entry = { id: InnstillingSeksjon; del?: string; label: string; hint: string; adminOnly?: boolean };
/**
 * Tre norske avsnitt over de faktiske innstillingene. Verdiene ligger der de alltid har ligget;
 * «del» ruller bare til riktig kort i samme seksjon (én kladd, én lagringslinje).
 */
const GROUPS: { title: string; entries: Entry[] }[] = [
  { title: "Automatisk behandling", entries: [
    { id: "priskontroll", del: "automatikk", label: "Matching og automatikk", hint: "Når linjer kobles og fakturaer avstemmes uten deg" },
    { id: "priskontroll", del: "startpris", label: "Startpris", hint: "Første dokumenterte pris fra en leverandør" },
  ] },
  { title: "Hva må kontrolleres", entries: [
    { id: "priskontroll", del: "prisavvik", label: "Prisavvik", hint: "Grenser for når en pris må vurderes" },
    { id: "priskontroll", del: "kategori", label: "Toleranse per kategori", hint: "Egne grenser for varekategorier" },
    { id: "kategorier", label: "Kategorier", hint: "Kategoriene varene sorteres i" },
  ] },
  { title: "Integrasjoner", entries: [
    { id: "tripletex", label: "Tripletex", hint: "Import av fakturaer" },
    { id: "ai", label: "AI-tjenester", hint: "Modell og tilkobling (plattformadministrator)", adminOnly: true },
  ] },
];
const keyOf = (e: Entry) => `${e.id}:${e.del ?? ""}`;

/** Én innstillingsside med seksjonsnavigasjon. Krever Råvarer-nivå approve eller admin. */
export default function RavarerInnstillinger() {
  const { accessLevel, loading } = useRavarer();
  const { data: isPlatformAdmin = false } = usePlatformAdmin();
  const [sp] = useSearchParams();
  const navigate = useGuardedNavigate();
  const groups = GROUPS.map((g) => ({ ...g, entries: g.entries.filter((e) => !e.adminOnly || isPlatformAdmin) }));
  const entries = groups.flatMap((g) => g.entries);
  const wanted = sp.get("seksjon");
  const active: InnstillingSeksjon = entries.find((e) => e.id === wanted)?.id ?? "priskontroll";
  const del = active === "priskontroll" ? sp.get("del") : null;
  const activeKey = `${active}:${del ?? (active === "priskontroll" ? "automatikk" : "")}`;
  const hrefOf = (e: Entry) => paths.innstillinger({ seksjon: e.id, ...(e.del ? { del: e.del } : {}) });
  // Rull til kortet når innholdet er lastet; finnes det ikke, skjer ingenting.
  useEffect(() => {
    if (!del) return;
    const t = window.setTimeout(() => document.getElementById(`innst-${del}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 150);
    return () => window.clearTimeout(t);
  }, [del, active]);
  const allowed = accessLevel === "approve" || accessLevel === "admin";

  if (loading) return <QueryLoadingState rows={4} />;
  if (!allowed) {
    return <QueryEmptyState title="Du har ikke tilgang til innstillinger for Råvarer" description="Innstillingene krever godkjenner- eller administratortilgang." />;
  }

  return (
    <ModulePage eyebrow={RAVARER_EYEBROW} title="Innstillinger" compact>
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <nav aria-label="Innstillinger" className="hidden md:block">
          {groups.map((g) => (
            <div key={g.title} className="mb-4">
              <h2 className="mb-1 px-3 text-caption font-semibold uppercase tracking-wide text-ink-secondary">{g.title}</h2>
              <ul className="space-y-0.5">
                {g.entries.map((e) => (
                  <li key={keyOf(e)}>
                    <Link to={hrefOf(e)} replace aria-current={keyOf(e) === activeKey ? "page" : undefined} title={e.hint}
                      className={cn("flex min-h-[44px] items-center rounded-md px-3 text-sm", keyOf(e) === activeKey ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted")}>
                      {e.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="md:hidden">
          <Select value={entries.find((e) => keyOf(e) === activeKey) ? activeKey : keyOf(entries[0])} onValueChange={(v) => { const e = entries.find((x) => keyOf(x) === v); if (e) navigate(hrefOf(e), { replace: true }); }}>
            <SelectTrigger aria-label="Velg innstilling" className="min-h-[44px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {groups.map((g) => g.entries.map((e) => <SelectItem key={keyOf(e)} value={keyOf(e)}>{g.title} · {e.label}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<QueryLoadingState rows={6} />}>
            {active === "priskontroll" && <MatchToleranser />}
            {active === "tripletex" && <Tripletex />}
            {active === "kategorier" && <Kategorier />}
            {active === "ai" && isPlatformAdmin && <AiTjenester />}
          </Suspense>
        </div>
      </div>
    </ModulePage>
  );
}
