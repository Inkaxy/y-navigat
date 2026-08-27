import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Award } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BrodskalanMark } from "@/varer/components/label/BrodskalanMark";
import type { GrainCategory } from "@/varer/lib/brodskalan";

interface Props {
  productId: string;
  canWrite: boolean;
}

const BREADSCALE: Array<{ value: number; label: string; desc: string; category: GrainCategory }> = [
  { value: 1, label: "Fint", desc: "under 26 % grovt", category: "fint" },
  { value: 2, label: "Halvgrovt", desc: "26–50,9 % grovt", category: "halvgrovt" },
  { value: 3, label: "Grovt", desc: "51–75,9 % grovt", category: "grovt" },
  { value: 4, label: "Ekstra grovt", desc: "76 % og over grovt", category: "ekstra_grovt" },
];

export function CertificationsEditor({ productId, canWrite }: Props) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["product-certifications", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("cert_nokkelhull, cert_norsk_100, breadscale_value")
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [nokkelhull, setNokkelhull] = useState(false);
  const [norsk100, setNorsk100] = useState(false);
  const [breadscale, setBreadscale] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setNokkelhull(!!data.cert_nokkelhull);
      setNorsk100(!!data.cert_norsk_100);
      setBreadscale(data.breadscale_value ?? null);
    }
  }, [data]);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("products")
      .update({
        cert_nokkelhull: nokkelhull,
        cert_norsk_100: norsk100,
        breadscale_value: breadscale,
      })
      .eq("id", productId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Merkeordninger lagret");
    qc.invalidateQueries({ queryKey: ["product-certifications", productId] });
    qc.invalidateQueries({ queryKey: ["product-info", productId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Award className="h-4 w-4" /> Merkeordninger
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label htmlFor="cert-nokkelhull" className="text-sm font-semibold">Nøkkelhullet</Label>
                <p className="text-xs text-muted-foreground">Helsedirektoratets merke for sunnere matvarer.</p>
              </div>
              <Switch
                id="cert-nokkelhull"
                checked={nokkelhull}
                disabled={!canWrite}
                onCheckedChange={setNokkelhull}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label htmlFor="cert-norsk100" className="text-sm font-semibold">100 % norsk</Label>
                <p className="text-xs text-muted-foreground">Alle hovedråvarer er norske.</p>
              </div>
              <Switch
                id="cert-norsk100"
                checked={norsk100}
                disabled={!canWrite}
                onCheckedChange={setNorsk100}
              />
            </div>

            <div className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <Label className="text-sm font-semibold">Brødskalaen / Grovhetsskala</Label>
                  <p className="text-xs text-muted-foreground">Andel sammalt mel og hele korn.</p>
                </div>
                {breadscale != null && canWrite && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setBreadscale(null)}>
                    Fjern
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {BREADSCALE.map((b) => (
                  <button
                    key={b.value}
                    type="button"
                    disabled={!canWrite}
                    onClick={() => setBreadscale(b.value)}
                    className={cn(
                      "rounded-md border p-2 text-left text-xs transition-all",
                      breadscale === b.value
                        ? "border-app bg-app/5 ring-1 ring-app/40"
                        : "border-border hover:border-foreground/20",
                      !canWrite && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <BrodskalanMark
                        category={b.category}
                        className={cn("h-8 w-8 shrink-0", breadscale !== b.value && "opacity-60")}
                      />
                      <span className="font-semibold">{b.label}</span>
                    </div>
                    <div className="text-muted-foreground">{b.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {canWrite && (
              <div className="flex justify-end">
                <Button onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Lagre merkeordninger
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
