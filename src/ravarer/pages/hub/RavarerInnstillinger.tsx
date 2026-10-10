import { lazy, Suspense } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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

const SECTIONS: { id: InnstillingSeksjon; label: string; adminOnly?: boolean }[] = [
  { id: "priskontroll", label: "Priskontroll" },
  { id: "tripletex", label: "Tripletex" },
  { id: "kategorier", label: "Kategorier" },
  { id: "ai", label: "AI-tjenester", adminOnly: true },
];

/** Én innstillingsside med seksjonsnavigasjon. Krever Råvarer-nivå approve eller admin. */
export default function RavarerInnstillinger() {
  const { accessLevel, loading } = useRavarer();
  const { data: isPlatformAdmin = false } = usePlatformAdmin();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const sections = SECTIONS.filter((s) => !s.adminOnly || isPlatformAdmin);
  const wanted = sp.get("seksjon");
  const active = sections.find((s) => s.id === wanted)?.id ?? "priskontroll";
  const allowed = accessLevel === "approve" || accessLevel === "admin";

  if (loading) return <QueryLoadingState rows={4} />;
  if (!allowed) {
    return <QueryEmptyState title="Du har ikke tilgang til innstillinger for Råvarer" description="Innstillingene krever godkjenner- eller administratortilgang." />;
  }

  return (
    <ModulePage eyebrow={RAVARER_EYEBROW} title="Innstillinger">
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <nav aria-label="Innstillinger" className="hidden md:block">
          <ul className="space-y-1">
            {sections.map((s) => (
              <li key={s.id}>
                <Link
                  to={paths.innstillinger({ seksjon: s.id })}
                  replace
                  aria-current={s.id === active ? "page" : undefined}
                  className={cn("block rounded-md px-3 py-1.5 text-sm", s.id === active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted")}
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="md:hidden">
          <Select value={active} onValueChange={(v) => navigate(paths.innstillinger({ seksjon: v as InnstillingSeksjon }), { replace: true })}>
            <SelectTrigger aria-label="Velg seksjon"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
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
