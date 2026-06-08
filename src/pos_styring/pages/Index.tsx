import { Card } from "@/components/ui/card";
import { Monitor, Users, Receipt, PlayCircle } from "lucide-react";

const stats = [
  { label: "Aktive terminaler", value: "—", icon: Monitor },
  { label: "Operatører", value: "—", icon: Users },
  { label: "Åpne sesjoner", value: "—", icon: PlayCircle },
  { label: "Transaksjoner i dag", value: "—", icon: Receipt },
];

const Index = () => {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Oversikt</h1>
        <p className="text-sm text-muted-foreground">
          Status for kassesystemet på tvers av butikker.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-app-pastel text-app-dark">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-xl font-semibold">{s.value}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-6">
        <h2 className="mb-2 text-base font-semibold">Velkommen</h2>
        <p className="text-sm text-muted-foreground">
          POS Styring er admin-verktøyet for kassesystemet. Bruk sidemenyen til
          å konfigurere terminaler, operatører, tastatur-layouts, kunder og
          produkter — og overvåke sesjoner, transaksjoner og rapporter.
        </p>
      </Card>
    </div>
  );
};

export default Index;
