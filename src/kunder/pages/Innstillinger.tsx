import { Link } from "react-router-dom";
import { MapPin, type LucideIcon } from "lucide-react";
import { AppBanner } from "@/kunder/components/shell/AppBanner";
import { SettingsSubMenu } from "@/kunder/components/shell/SettingsSubMenu";
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
  {
    to: "/kunder/innstillinger/hentesteder",
    title: "Hentesteder",
    desc: "Definer hvor kunder kan hente bestillinger.",
    icon: MapPin,
    active: true,
  },
];

export default function Innstillinger() {
  return (
    <>
      <AppBanner title="Innstillinger" subtitle="App-spesifikke innstillinger for Kunder" />
      <SettingsSubMenu />
      <div className="container py-6">
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
      </div>
    </>
  );
}
