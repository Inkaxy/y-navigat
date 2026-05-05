import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePickupLocations } from "@/hooks/usePickupLocations";

const NONE_VALUE = "__none__";

type Props = {
  legalEntityId: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label?: string;
};

/** Dropdown for å velge hentested. Tom verdi = "ingen / kun levering". */
export function PickupLocationSelect({
  legalEntityId,
  value,
  onChange,
  disabled,
  label = "Standard hentested",
}: Props) {
  const { data: locations } = usePickupLocations(legalEntityId, { onlyActive: true });

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <Select
        value={value ? value : NONE_VALUE}
        onValueChange={(v) => onChange(v === NONE_VALUE ? "" : v)}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>— Ingen (kun levering)</SelectItem>
          {(locations ?? []).map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.pickup_number} — {p.display_name}
              {p.city ? ` (${p.city})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
