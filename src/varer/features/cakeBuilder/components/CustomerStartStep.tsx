import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface CustomerMeta {
  pickup_date: string | null; // ISO yyyy-MM-dd
  pickup_location_id: string | null;
  name: string;
  phone: string;
  email: string;
}

type PickupLocOpt = { id: string; pickup_number: number; display_name: string };

interface Props {
  legalEntityId: string;
  defaultPickupLocationId?: string | null;
  value: CustomerMeta;
  onChange: (v: CustomerMeta) => void;
}

export function CustomerStartStep({
  legalEntityId,
  defaultPickupLocationId,
  value,
  onChange,
}: Props) {
  const [locations, setLocations] = useState<PickupLocOpt[]>([]);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("pickup_locations" as never)
        .select("id, pickup_number, display_name, status")
        .eq("legal_entity_id" as never, legalEntityId as never)
        .eq("status" as never, "active" as never)
        .order("pickup_number" as never, { ascending: true });
      if (cancel) return;
      setLocations(((data ?? []) as unknown as PickupLocOpt[]) ?? []);
    })();
    return () => {
      cancel = true;
    };
  }, [legalEntityId]);

  // Apply default pickup location once we have locations + no value yet
  useEffect(() => {
    if (value.pickup_location_id) return;
    const def = defaultPickupLocationId
      ? locations.find((l) => l.id === defaultPickupLocationId)
      : locations[0];
    if (def) onChange({ ...value, pickup_location_id: def.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, defaultPickupLocationId]);

  const dateValue = value.pickup_date ? new Date(value.pickup_date) : undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h2 className="text-xl font-semibold">Kundeopplysninger</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Fyll inn hentedato, hentested og kontaktinfo før du bygger kaken.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pickup-date">Hentedato *</Label>
        <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              id="pickup-date"
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !dateValue && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateValue ? format(dateValue, "PPP") : <span>Velg dato</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateValue}
              onSelect={(d) => {
                if (d) {
                  onChange({ ...value, pickup_date: format(d, "yyyy-MM-dd") });
                  setDatePopoverOpen(false);
                }
              }}
              disabled={(d) => d < today}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pickup-loc">Hentested *</Label>
        <Select
          value={value.pickup_location_id ?? undefined}
          onValueChange={(v) => onChange({ ...value, pickup_location_id: v })}
        >
          <SelectTrigger id="pickup-loc">
            <SelectValue placeholder="Velg hentested" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.pickup_number} — {l.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="name">Navn *</Label>
        <Input
          id="name"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="Fornavn Etternavn"
          maxLength={120}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="phone">Telefon *</Label>
        <Input
          id="phone"
          value={value.phone}
          onChange={(e) => onChange({ ...value, phone: e.target.value })}
          placeholder="+47 ..."
          maxLength={32}
          inputMode="tel"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="email">E-post (valgfritt)</Label>
        <Input
          id="email"
          type="email"
          value={value.email}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
          placeholder="navn@eksempel.no"
          maxLength={200}
        />
      </div>
    </div>
  );
}
