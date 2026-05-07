import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, MapPin, Save, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useLegalEntitySettings,
  useUpdateLegalEntitySettings,
  useWeatherLocation,
} from "@/ordre/hooks/useLegalEntitySettings";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";

export default function DeliveryNoteSettings() {
  const settingsQ = useLegalEntitySettings(NB_LEGAL_ENTITY_ID);
  const updateMut = useUpdateLegalEntitySettings(NB_LEGAL_ENTITY_ID);
  const currentLoc = useWeatherLocation(NB_LEGAL_ENTITY_ID);

  const [lat, setLat] = useState<string>("");
  const [lon, setLon] = useState<string>("");

  useEffect(() => {
    if (!settingsQ.isLoading) {
      setLat(String(currentLoc.lat));
      setLon(String(currentLoc.lon));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQ.isLoading]);

  async function save() {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      toast.error("Ugyldig breddegrad (lat)");
      return;
    }
    if (!Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
      toast.error("Ugyldig lengdegrad (lon)");
      return;
    }
    try {
      await updateMut.mutateAsync({
        weather_location: { lat: latNum, lon: lonNum },
      });
      toast.success("Vær-posisjon lagret");
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke lagre");
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 space-y-6">
      <div>
        <Link to="/pakksedler">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Tilbake
          </Button>
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold">
          <SettingsIcon className="h-6 w-6 text-primary" />
          Pakksedler – Innstillinger
        </h1>
        <p className="text-sm text-muted-foreground">
          Konfigurer hovedkjørings-relaterte parametere.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Standard vær-posisjon</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Brukes av værvarslet i Matrise-visningen. Default Nøtterøy (59.22, 10.42).
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="lat">Breddegrad (lat)</Label>
            <Input
              id="lat"
              type="number"
              step="0.0001"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              disabled={settingsQ.isLoading}
              placeholder="59.22"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lon">Lengdegrad (lon)</Label>
            <Input
              id="lon"
              type="number"
              step="0.0001"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              disabled={settingsQ.isLoading}
              placeholder="10.42"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={updateMut.isPending} className="gap-2">
            <Save className="h-4 w-4" />
            {updateMut.isPending ? "Lagrer…" : "Lagre vær-posisjon"}
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3 opacity-70">
        <h2 className="text-lg font-semibold">Automatisk hovedkjøring</h2>
        <p className="text-sm text-muted-foreground">
          Planlagt cron-kjøring av hovedkjøring (kommer i senere fase).
        </p>
        <div className="space-y-2">
          <Label htmlFor="cron-time">Tidspunkt for daglig kjøring</Label>
          <Input id="cron-time" type="time" disabled placeholder="06:00" />
          <p className="text-xs text-muted-foreground">Funksjonalitet ikke aktivert ennå.</p>
        </div>
      </Card>
    </div>
  );
}
