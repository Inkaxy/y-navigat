import { useEffect, useState } from "react";
import { Building2, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import {
  DEFAULT_ORDRE_DESK_SETTINGS,
  useOrdreDeskSettings,
  useSaveOrdreDeskSettings,
  type OrdreDeskSettings,
} from "@/ordre/hooks/useOrdreDeskSettings";

/** Verdier ordrekontoret tidligere måtte be om kodeendring for å justere. */
export function OrdreDeskSettingsCard() {
  const { data, isLoading } = useOrdreDeskSettings();
  const save = useSaveOrdreDeskSettings();
  const { toast } = useToast();
  const [form, setForm] = useState<OrdreDeskSettings>(DEFAULT_ORDRE_DESK_SETTINGS);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const onSave = async () => {
    try {
      await save.mutateAsync(form);
      toast({ title: "Innstillinger for ordrekontoret er lagret" });
    } catch (e) {
      toast({
        title: "Lagring feilet",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" aria-hidden="true" />
          Ordrekontor
        </CardTitle>
        <CardDescription>
          Grenser og standardtekster som brukes i innboksen og tilbakebetalinger.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Laster …</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="desk-refund-limit">Refusjonsgrense for godkjenning (kr)</Label>
                <Input
                  id="desk-refund-limit"
                  type="number"
                  min={0}
                  step={50}
                  value={form.refundApprovalLimit}
                  onChange={(e) =>
                    setForm({ ...form, refundApprovalLimit: Number(e.target.value) })
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Beløp over denne grensen må godkjennes før utbetaling.
                </p>
              </div>
              <div>
                <Label htmlFor="desk-max-attachment">Maks vedleggsstørrelse (MB)</Label>
                <Input
                  id="desk-max-attachment"
                  type="number"
                  min={1}
                  max={500}
                  value={form.maxAttachmentMb}
                  onChange={(e) => setForm({ ...form, maxAttachmentMb: Number(e.target.value) })}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="desk-signature">Signatur ved videresending</Label>
              <Input
                id="desk-signature"
                value={form.forwardSignature}
                onChange={(e) => setForm({ ...form, forwardSignature: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="desk-conf-high">Konfidensgrense «Høy» (0–1)</Label>
                <Input
                  id="desk-conf-high"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.confidenceHigh}
                  onChange={(e) => setForm({ ...form, confidenceHigh: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="desk-conf-medium">Konfidensgrense «Middels» (0–1)</Label>
                <Input
                  id="desk-conf-medium"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.confidenceMedium}
                  onChange={(e) => setForm({ ...form, confidenceMedium: Number(e.target.value) })}
                />
              </div>
            </div>

            <Button onClick={() => void onSave()} disabled={save.isPending} className="gap-2">
              <Save className="h-4 w-4" aria-hidden="true" />
              Lagre
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
