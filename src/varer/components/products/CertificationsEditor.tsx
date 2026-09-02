import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Award, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { BrodskalanMark } from "@/varer/components/label/BrodskalanMark";
import { grainCategoryFromBreadscaleValue } from "@/varer/lib/brodskalan";
import { grainLevelLabel, fmtPct } from "@/varer/lib/breadscale";

interface Props {
  productId: string;
  canWrite: boolean;
}

/**
 * Merkeordninger på produktet.
 * Grovheten settes IKKE her — den styres av bryteren i Grovhet-seksjonen og av
 * oppskriftens brytere. Nøkkelhullet og visning av Brødskala'n arves automatisk
 * fra oppskriften når produktet har en primærkobling.
 */
export function CertificationsEditor({ productId, canWrite }: Props) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["product-certifications", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("cert_nokkelhull, cert_norsk_100, show_breadscale, breadscale_value, breadscale_pct")
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: primaryLink } = useQuery({
    queryKey: ["product-primary-recipe-link", productId],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_recipe_links")
        .select("recipe_id, is_primary, recipes(name)")
        .eq("product_id", productId)
        .eq("is_primary", true)
        .limit(1)
        .maybeSingle();
      return data as { recipe_id: string | null; recipes?: { name?: string | null } | null } | null;
    },
  });

  const [nokkelhull, setNokkelhull] = useState(false);
  const [norsk100, setNorsk100] = useState(false);
  const [showBreadscale, setShowBreadscale] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setNokkelhull(!!data.cert_nokkelhull);
      setNorsk100(!!data.cert_norsk_100);
      setShowBreadscale(!!data.show_breadscale);
    }
  }, [data]);

  const inherited = !!primaryLink?.recipe_id;
  const recipeName = primaryLink?.recipes?.name ?? "oppskriften";
  const category = grainCategoryFromBreadscaleValue(data?.breadscale_value);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("products")
      .update({
        cert_nokkelhull: nokkelhull,
        cert_norsk_100: norsk100,
        show_breadscale: showBreadscale,
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

  const inheritedNote = inherited ? (
    <p className="mt-1 text-xs text-muted-foreground">
      Arvet fra oppskriften {recipeName}
      {primaryLink?.recipe_id && (
        <Link
          to={`/varer/oppskrifter/${primaryLink.recipe_id}?tab=merking`}
          className="ml-1 inline-flex items-center gap-1 text-primary underline underline-offset-2"
        >
          Endre i oppskriften
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </p>
  ) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Award className="h-4 w-4" /> Merkeordninger
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label htmlFor="cert-nokkelhull" className="text-sm font-semibold">
                  Nøkkelhullet
                </Label>
                <p className="text-xs text-muted-foreground">Helsedirektoratets merke for sunnere matvarer.</p>
                {inheritedNote}
              </div>
              <Switch
                id="cert-nokkelhull"
                checked={nokkelhull}
                disabled={!canWrite || inherited}
                onCheckedChange={setNokkelhull}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label htmlFor="cert-norsk100" className="text-sm font-semibold">
                  100 % norsk
                </Label>
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
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor="show-breadscale" className="text-sm font-semibold">
                    Vis Brødskala'n på etikett
                  </Label>
                  <p className="text-xs text-muted-foreground">Merket trykkes bare når dette er slått på.</p>
                  {inheritedNote}
                </div>
                <Switch
                  id="show-breadscale"
                  checked={showBreadscale}
                  disabled={!canWrite || inherited}
                  onCheckedChange={setShowBreadscale}
                />
              </div>

              <div className="mt-3 flex items-center gap-3 rounded-md bg-muted/40 p-2">
                {category && <BrodskalanMark category={category} className="h-10 w-10 shrink-0" />}
                <div className="text-sm">
                  <div className="font-medium tabular-nums">
                    {category
                      ? `Trinn ${data?.breadscale_value} ${grainLevelLabel(category)} · ${fmtPct(data?.breadscale_pct ?? null)}`
                      : "Ingen grovhet satt"}
                  </div>
                  <p className="text-xs text-muted-foreground">Styres i Grovhet-seksjonen.</p>
                </div>
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
