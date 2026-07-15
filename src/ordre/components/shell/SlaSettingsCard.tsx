import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, Save } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useSlaSettings, useSaveSlaSettings } from "@/ordre/hooks/useSlaSettings";
import { DEFAULT_SLA, DEFAULT_BUSINESS_HOURS, type SlaDeadlines, type BusinessHours } from "@/ordre/lib/sla";

const INTENT_LABEL: Record<string, string> = {
  complaint: "Klage",
  change: "Endring",
  new_order: "Ny bestilling",
  cancellation: "Avbestilling",
  question: "Spørsmål",
};

export function SlaSettingsCard() {
  const { data, isLoading } = useSlaSettings();
  const save = useSaveSlaSettings();
  const { toast } = useToast();
  const [sla, setSla] = useState<SlaDeadlines>(DEFAULT_SLA);
  const [bh, setBh] = useState<BusinessHours>(DEFAULT_BUSINESS_HOURS);

  useEffect(() => {
    if (data) {
      setSla(data.sla);
      setBh(data.bh);
    }
  }, [data]);

  const onSave = async () => {
    try {
      await save.mutateAsync({ sla, bh });
      toast({ title: "SLA-frister lagret" });
    } catch (e) {
      toast({ title: "Lagring feilet", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Svarfrister (SLA)
        </CardTitle>
        <CardDescription>
          Timer i åpningstid fra e-posten mottas til første svar. Fristbrudd vises rødt i innboksen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Laster …</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {Object.keys(INTENT_LABEL).map((k) => (
                <div key={k}>
                  <Label className="text-xs">{INTENT_LABEL[k]} (timer)</Label>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={sla[k as keyof SlaDeadlines] ?? ""}
                    onChange={(e) => setSla({ ...sla, [k]: Number(e.target.value) })}
                  />
                </div>
              ))}
            </div>
            <div className="border-t pt-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Åpningstid</Label>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Fra (time)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={bh.start_hour}
                    onChange={(e) => setBh({ ...bh, start_hour: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Til (time)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={bh.end_hour}
                    onChange={(e) => setBh({ ...bh, end_hour: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Arbeidsdager (0=søn…6=lør)</Label>
                  <Input
                    value={bh.workdays.join(",")}
                    onChange={(e) =>
                      setBh({
                        ...bh,
                        workdays: e.target.value
                          .split(",")
                          .map((s) => Number(s.trim()))
                          .filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6),
                      })
                    }
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={onSave} disabled={save.isPending} className="gap-2">
                <Save className="h-4 w-4" /> Lagre frister
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
