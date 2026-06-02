import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  MoreHorizontal,
  Square,
  Trash2,
  Underline,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ALIGNMENTS, type ProfileField, type Alignment } from "../../types";
import { FontSizeStepper } from "./RightInspector";

interface Props {
  field: ProfileField;
  onChange: (patch: Partial<ProfileField>) => void;
  onRemove: () => void;
}

const alignIcon = (a: Alignment) => {
  if (a === "center") return <AlignCenter className="h-3.5 w-3.5" />;
  if (a === "right") return <AlignRight className="h-3.5 w-3.5" />;
  return <AlignLeft className="h-3.5 w-3.5" />;
};

export function InlineToolbar({ field, onChange, onRemove }: Props) {
  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-md border border-border bg-popover p-1 shadow-md"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <FontSizeStepper
        value={field.font_size}
        onChange={(v) => onChange({ font_size: v })}
      />

      <Button
        type="button"
        variant={field.bold ? "default" : "ghost"}
        size="icon"
        className="h-7 w-7"
        onClick={() => onChange({ bold: !field.bold })}
        aria-label="Fet"
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>

      <Separator orientation="vertical" className="mx-0.5 h-5" />

      <div className="flex items-center gap-0.5">
        {ALIGNMENTS.map((a) => (
          <Button
            key={a}
            type="button"
            variant={field.alignment === a ? "default" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => onChange({ alignment: a })}
            aria-label={a}
          >
            {alignIcon(a)}
          </Button>
        ))}
      </div>

      <Separator orientation="vertical" className="mx-0.5 h-5" />

      <Button
        type="button"
        variant={field.show_line ? "default" : "ghost"}
        size="icon"
        className="h-7 w-7"
        onClick={() => onChange({ show_line: !field.show_line })}
        aria-label="Linje under"
        title="Linje under"
      >
        <Underline className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant={field.show_border ? "default" : "ghost"}
        size="icon"
        className="h-7 w-7"
        onClick={() => onChange({ show_border: !field.show_border })}
        aria-label="Ramme rundt"
        title="Ramme rundt"
      >
        <Square className="h-3.5 w-3.5" />
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Mer"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-56 space-y-3"
          align="end"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <Checkbox
              id={`fc-bottom-${field.field_type}`}
              checked={field.print_at_bottom}
              onCheckedChange={(v) => onChange({ print_at_bottom: !!v })}
            />
            <Label
              htmlFor={`fc-bottom-${field.field_type}`}
              className="text-xs font-normal"
            >
              Lås til bunn av etiketten
            </Label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Når aktivert vil feltet alltid plasseres nederst på etiketten ved
            utskrift, uavhengig av Y-koordinat.
          </p>
        </PopoverContent>
      </Popover>

      <Separator orientation="vertical" className="mx-0.5 h-5" />

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive",
        )}
        onClick={onRemove}
        aria-label="Fjern fra etiketten"
        title="Fjern fra etiketten"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
