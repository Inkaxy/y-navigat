import { Card, CardContent } from "@/components/ui/card";
import { Settings as SettingsIcon } from "lucide-react";

export default function SettingsGeneral() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-app/10 text-app">
          <SettingsIcon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Generelt</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Generelle innstillinger for Varer-appen.
          </p>
        </div>
      </div>
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Generelle innstillinger (standard MVA-rate, default salgsenhet, m.m.) kommer senere.
        </CardContent>
      </Card>
    </div>
  );
}
