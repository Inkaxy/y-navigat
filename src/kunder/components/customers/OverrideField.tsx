import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  formatInheritedValue,
  type ProfileFieldDef,
  type SelectOption,
} from "@/kunder/lib/profileFields";

type Props = {
  field: ProfileFieldDef;
  /** Verdi fra profilen (default som arves) */
  inheritedValue: unknown;
  /** Override-verdi på kunde-nivå (kun definert når `isOverridden = true`) */
  overrideValue: unknown;
  isOverridden: boolean;
  disabled?: boolean;
  onOverride: (value: unknown) => void;
  onClear: () => void;
  /** Overstyrer field.options for select-felter med dynamisk-fetched valg (FK). */
  dynamicOptions?: SelectOption[];
};

/**
 * Felt som viser både profilens default og en valgfri override.
 * Viser arvet verdi grå når ikke overstyrt; lar bruker låse opp og angi egen verdi.
 */
export function OverrideField({
  field,
  inheritedValue,
  overrideValue,
  isOverridden,
  disabled,
  onOverride,
  onClear,
  dynamicOptions,
}: Props) {
  const value = isOverridden ? overrideValue : inheritedValue;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label
          className={cn(
            "text-xs font-medium",
            isOverridden ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {field.label}
          {isOverridden && (
            <span className="ml-1.5 inline-flex items-center gap-1 rounded-sm bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
              Overstyrt
            </span>
          )}
        </Label>

        {!disabled && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (isOverridden) {
                    onClear();
                  } else {
                    onOverride(coerceInitial(field, inheritedValue));
                  }
                }}
              >
                {isOverridden ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isOverridden ? "Tilbakestill til profil-default" : "Overstyr på denne kunden"}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <FieldInput
        field={field}
        value={value}
        disabled={disabled || !isOverridden}
        onChange={(v) => onOverride(v)}
        dynamicOptions={dynamicOptions}
      />

      {field.description && (
        <p className="text-[11px] leading-snug text-muted-foreground/80">{field.description}</p>
      )}

      {!isOverridden && (
        <p className="text-[11px] text-muted-foreground">
          Arvet fra profil:{" "}
          <span className="font-medium">
            {formatInheritedValue(field, inheritedValue, dynamicOptions)}
          </span>
        </p>
      )}
    </div>
  );
}

function coerceInitial(field: ProfileFieldDef, inherited: unknown) {
  if (field.type === "boolean") return !!inherited;
  if (field.type === "number") return inherited ?? 0;
  return inherited ?? "";
}

function FieldInput({
  field,
  value,
  disabled,
  onChange,
  dynamicOptions,
}: {
  field: ProfileFieldDef;
  value: unknown;
  disabled?: boolean;
  onChange: (v: unknown) => void;
  dynamicOptions?: SelectOption[];
}) {
  switch (field.type) {
    case "boolean":
      return (
        <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3">
          <Switch
            checked={!!value}
            onCheckedChange={(v) => onChange(!!v)}
            disabled={disabled}
          />
          <span className="text-sm text-muted-foreground">{value ? "Ja" : "Nei"}</span>
        </div>
      );
    case "select": {
      const opts = dynamicOptions ?? field.options ?? [];
      return (
        <Select
          value={value ? String(value) : undefined}
          onValueChange={(v) => onChange(v)}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "textarea":
      return (
        <Textarea
          rows={3}
          value={(value as any) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          inputMode="decimal"
          step={field.step}
          min={field.min}
          max={field.max}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
          disabled={disabled}
          placeholder={field.placeholder}
        />
      );
    case "email":
      return (
        <Input
          type="email"
          value={(value as any) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder}
        />
      );
    case "text":
    default:
      return (
        <Input
          value={(value as any) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder}
        />
      );
  }
}
