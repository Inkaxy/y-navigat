import { Link } from "react-router-dom";
import {
  Users, KeyRound, Store, Briefcase, AppWindow,
  Plug, HeartPulse, ScrollText, ShieldCheck, type LucideIcon,
} from "lucide-react";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Area = {
  to: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  active: boolean;
};

const AREAS: Area[] = [
  { to: "/admin/brukere",      title: "Brukere",      desc: "Ansatte og deres stillinger.",                icon: Users, active: true },
  { to: "/admin/tilganger",    title: "Tilganger",    desc: "Stilling × app tilgangsmatrise.",             icon: KeyRound, active: true },
  { to: "/admin/outlets",      title: "Butikker",     desc: "Butikker, bakerier og produksjonssteder.",    icon: Store, active: true },
  { to: "/admin/stillinger",   title: "Stillinger",   desc: "Stillingsmaler og kategorier.",               icon: Briefcase, active: true },
  { to: "/admin/apper",        title: "Apper",        desc: "Registrerte NBOS-apper og status.",           icon: AppWindow, active: true },
  { to: "/admin/integrasjoner",title: "Integrasjoner",desc: "Eksterne systemer og API-koblinger.",         icon: Plug, active: true },
  { to: "/admin/helsesenter",  title: "Helsesenter",  desc: "Systemstatus og diagnostikk.",                icon: HeartPulse, active: true },
  { to: "/admin/audit",        title: "Audit",        desc: "Endringslogg og sikkerhetshendelser.",        icon: ScrollText, active: true },
];

export default function AdminIndex() {
  return (
    <AdminLayout>
      <AppHeaderBanner
        icon={ShieldCheck}
        title="NBOS Admin"
        subtitle="Konfigurer brukere, tilganger og system."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AREAS.map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.to} to={a.to} className="group">
              <Card className="h-full transition hover:border-app hover:shadow-sm">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-app/10 text-app">
                      <Icon className="h-5 w-5" />
                    </div>
                    <Badge variant={a.active ? "default" : "secondary"}>
                      {a.active ? "Aktiv" : "Kommer snart"}
                    </Badge>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground group-hover:text-app">{a.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{a.desc}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </AdminLayout>
  );
}
