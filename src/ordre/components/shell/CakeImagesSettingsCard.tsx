import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ImageIcon, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { CAKE_BUCKET } from "@/ordre/lib/cakeImages";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import {
  useLegalEntitySettings,
  useUpdateLegalEntitySettings,
} from "@/ordre/hooks/useLegalEntitySettings";

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; detail: string }
  | { kind: "err"; detail: string };

export function CakeImagesSettingsCard() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useLegalEntitySettings(NB_LEGAL_ENTITY_ID);
  const update = useUpdateLegalEntitySettings(NB_LEGAL_ENTITY_ID);

  const current = Number(
    (settings?.cake_images_retention_days as number | undefined) ?? 30,
  );
  const [days, setDays] = useState<number>(current);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  useEffect(() => {
    setDays(current);
  }, [current]);

  const dirty = days !== current && days >= 1 && days <= 3650;

  async function runTest() {
    setTest({ kind: "running" });
    try {
      // 1) Bekreft pålogging
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Du må være logget inn");

      // 2) List filer i din legal_entitys mappe (verifiserer storage-RLS)
      const { data: list, error: listErr } = await supabase.storage
        .from(CAKE_BUCKET)
        .list(NB_LEGAL_ENTITY_ID, { limit: 1 });
      if (listErr) throw listErr;

      // 3) Signed URL-test: forsøk å hente signed URL for en eksisterende fil
      let signedDetail = "Ingen filer å signere ennå";
      const { data: rows } = await supabase
        .from("cake_images")
        .select("original_path")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .limit(1);
      const path = rows?.[0]?.original_path;
      if (path) {
        const { data: signed, error: sErr } = await supabase.storage
          .from(CAKE_BUCKET)
          .createSignedUrl(path, 60);
        if (sErr) throw sErr;
        signedDetail = signed?.signedUrl ? "Signed URL OK" : "Tom signed URL";
      }

      setTest({
        kind: "ok",
        detail: `Bøtte: OK · Oppføringer i mappe: ${list?.length ?? 0} · ${signedDetail}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTest({
        kind: "err",
        detail:
          msg.includes("not found") || msg.includes("Bucket")
            ? `Bøtte '${CAKE_BUCKET}' mangler. Opprett den (privat) i Supabase → Storage. (${msg})`
            : msg,
      });
    }
  }

  async function save() {
    try {
      await update.mutateAsync({ cake_images_retention_days: days });
      toast({ title: "Lagret", description: `Sletter etter ${days} dager.` });
    } catch (e) {
      toast({
        title: "Kunne ikke lagre",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              Kakebilder
            </CardTitle>
            <CardDescription>
              Lagring og automatisk opprydding av utskrevne kakebilder.
            </CardDescription>
          </div>
          {test.kind === "ok" ? (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Bøtte OK
            </Badge>
          ) : test.kind === "err" ? (
            <Badge variant="outline" className="gap-1 border-destructive text-destructive">
              <AlertCircle className="h-3 w-3" /> Feil
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="retention-days">Slett utskrevne bilder etter (dager)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="retention-days"
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))}
              className="w-32"
              disabled={isLoading}
            />
            <Button onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Lagre
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Bilder med status «Skrevet ut» og med utskriftstidspunkt eldre enn dette
            slettes automatisk hver natt (kl. 03:15 UTC). Originalen og redigert versjon
            fjernes også fra lageret.
          </p>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Test bøtte og signed URLs</div>
            <Button size="sm" variant="outline" onClick={runTest} disabled={test.kind === "running"}>
              {test.kind === "running" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Tester …
                </>
              ) : (
                "Kjør test"
              )}
            </Button>
          </div>
          {test.kind === "ok" && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">{test.detail}</p>
          )}
          {test.kind === "err" && (
            <p className="text-xs text-destructive">{test.detail}</p>
          )}
          {test.kind === "idle" && (
            <p className="text-xs text-muted-foreground">
              Verifiserer at bøtta <code className="rounded bg-background px-1">{CAKE_BUCKET}</code> finnes,
              at RLS gir tilgang til din virksomhets mappe, og at signed URLs kan genereres.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
