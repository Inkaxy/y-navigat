import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { FileDown } from "lucide-react";
import { Card } from "@/components/ui/card";

interface SettingsLink {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
}

const LINKS: SettingsLink[] = [
  {
    href: "/pos-styring/innstillinger/saf-t",
    title: "SAF-T Kassasystem",
    description:
      "Eksporter elektronisk journal i Skatteetatens SAF-T Cash Register XML-format for utlevering.",
    icon: <FileDown className="h-5 w-5" />,
  },
];

export default function Innstillinger() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Innstillinger</h1>
        <p className="text-sm text-muted-foreground">
          Kassesystem-konfigurasjon for hele virksomheten.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {LINKS.map((l) => (
          <Link key={l.href} to={l.href} className="block">
            <Card className="p-4 h-full hover:border-primary/40 hover:shadow-sm transition-colors">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 text-primary">{l.icon}</div>
                <div className="space-y-1">
                  <div className="font-semibold">{l.title}</div>
                  <p className="text-sm text-muted-foreground">{l.description}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
