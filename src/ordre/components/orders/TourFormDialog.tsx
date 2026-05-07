import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { logAudit } from "@/ordre/lib/audit";
import { type DeliveryTour, DAY_LABELS, trimSec } from "@/ordre/hooks/useDeliveryTours";

type Props = {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  tour: DeliveryTour | null;
  /** Foreslått neste tour_number for ny tur */
  nextTourNumber: number;
  onSaved: () => void;
};

const DAY_FIELDS = [
  "active_monday",
  "active_tuesday",
  "active_wednesday",
  "active_thursday",
  "active_friday",
  "active_saturday",
  "active_sunday",
] as const;

export function TourFormDialog({ open, onOpenChange, tour, nextTourNumber, onSaved }: Props) {
  const isEdit = !!tour;
  const [tourNumber, setTourNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [timeFrom, setTimeFrom] = useState("05:00");
  const [timeTo, setTimeTo] = useState("09:00");
  const [days, setDays] = useState<boolean[]>([true, true, true, true, true, false, false]);
  const [active, setActive] = useState(true);
  const [driverName, setDriverName] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [priority, setPriority] = useState("1");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (tour) {
      setTourNumber(String(tour.tour_number));
      setDisplayName(tour.display_name);
      setDescription(tour.description ?? "");
      setTimeFrom(trimSec(tour.time_from));
      setTimeTo(trimSec(tour.time_to));
      setDays(DAY_FIELDS.map((k) => Boolean(tour[k])));
      setActive(tour.status === "active");
      setDriverName(tour.driver_name ?? "");
      setDepartureTime(tour.departure_time ? trimSec(tour.departure_time) : "");
      setPriority(String(tour.priority ?? 1));
    } else {
      setTourNumber(String(nextTourNumber));
      setDisplayName("");
      setDescription("");
      setTimeFrom("05:00");
      setTimeTo("09:00");
      setDays([true, true, true, true, true, false, false]);
      setActive(true);
      setDriverName("");
      setDepartureTime("");
      setPriority("1");
    }
  }, [open, tour, nextTourNumber]);

  async function handleSave() {
    if (!displayName.trim()) {
      toast.error("Navn er obligatorisk");
      return;
    }
    if (!timeFrom || !timeTo || timeFrom >= timeTo) {
      toast.error("Tidsvindu må være gyldig (fra < til)");
      return;
    }
    const tn = parseInt(tourNumber, 10);
    if (!Number.isFinite(tn) || tn < 1) {
      toast.error("Tur-nummer må være et positivt tall");
      return;
    }
    const prio = parseInt(priority, 10);
    if (!Number.isFinite(prio) || prio < 1 || prio > 99) {
      toast.error("Prioritet må være mellom 1 og 99");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        legal_entity_id: NB_LEGAL_ENTITY_ID,
        tour_number: tn,
        display_name: displayName.trim(),
        description: description.trim() || null,
        time_from: timeFrom + ":00",
        time_to: timeTo + ":00",
        active_monday: days[0],
        active_tuesday: days[1],
        active_wednesday: days[2],
        active_thursday: days[3],
        active_friday: days[4],
        active_saturday: days[5],
        active_sunday: days[6],
        status: active ? "active" : "inactive",
        driver_name: driverName.trim() || null,
        departure_time: departureTime ? departureTime + ":00" : null,
        priority: prio,
      };

      if (isEdit && tour) {
        const { error } = await supabase
          .from("delivery_tours")
          .update(payload)
          .eq("id", tour.id);
        if (error) throw error;
        await logAudit({
          action: "updated",
          entity_type: "delivery_tour",
          entity_id: tour.id,
          entity_display_reference: `${tn} — ${displayName.trim()}`,
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          changes: payload as unknown as Record<string, unknown>,
        });
        toast.success(`Tur ${tn} oppdatert`);
      } else {
        const { data: userRes } = await supabase.auth.getUser();
        const { data: inserted, error } = await supabase
          .from("delivery_tours")
          .insert({ ...payload, created_by: userRes.user?.id ?? null })
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({
          action: "created",
          entity_type: "delivery_tour",
          entity_id: inserted.id,
          entity_display_reference: `${tn} — ${displayName.trim()}`,
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          changes: payload as unknown as Record<string, unknown>,
        });
        toast.success(`Tur ${tn} opprettet`);
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ukjent feil";
      if (msg.includes("unique_tour_number_per_entity")) {
        toast.error(`Tur-nummer ${tourNumber} finnes allerede`);
      } else {
        toast.error(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Rediger tur ${tour?.tour_number}` : "Ny tur"}</DialogTitle>
          <DialogDescription>
            Definer tidsvindu og aktive ukedager. Auto-tildeling av ordre baseres på dette.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[100px_1fr] gap-3">
            <div>
              <Label htmlFor="tn">Tur-nr</Label>
              <Input
                id="tn"
                type="number"
                min="1"
                value={tourNumber}
                onChange={(e) => setTourNumber(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="dn">Navn</Label>
              <Input
                id="dn"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="F.eks. Morgentur"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="desc">Beskrivelse (valgfri)</Label>
            <Textarea
              id="desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Intern notat om turen"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tf">Tidsvindu fra</Label>
              <Input id="tf" type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="tt">Tidsvindu til</Label>
              <Input id="tt" type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_120px_120px] gap-3">
            <div>
              <Label htmlFor="drv">Sjåfør</Label>
              <Input
                id="drv"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="F.eks. Ola Nordmann"
              />
            </div>
            <div>
              <Label htmlFor="dep">Avgangstid</Label>
              <Input
                id="dep"
                type="time"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="prio">Prioritet</Label>
              <Input
                id="prio"
                type="number"
                min="1"
                max="99"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Lavest nummer først. Like sorteres alfabetisk.
              </p>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Aktive ukedager</Label>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, i) => (
                <label
                  key={label}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
                >
                  <Checkbox
                    checked={days[i]}
                    onCheckedChange={(c) =>
                      setDays((prev) => prev.map((v, idx) => (idx === i ? Boolean(c) : v)))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {isEdit && (
            <div className="flex items-center justify-between rounded-md border border-border p-2.5">
              <div>
                <div className="text-sm font-medium">Aktiv</div>
                <div className="text-xs text-muted-foreground">Inaktive turer brukes ikke i auto-tildeling.</div>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Avbryt
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Lagre" : "Opprett"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
