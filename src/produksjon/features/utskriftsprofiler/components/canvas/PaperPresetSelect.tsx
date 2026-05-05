import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PAPER_PRESETS, matchPreset } from "../../lib/canvasUtils";

interface Props {
  width: number;
  height: number;
  onChange: (w: number, h: number) => void;
}

export function PaperPresetSelect({ width, height, onChange }: Props) {
  const currentId = matchPreset(width, height);
  const currentLabel =
    currentId === "custom"
      ? `Egendefinert (${width} × ${height} mm)`
      : (PAPER_PRESETS.find((p) => p.id === currentId)?.label ?? "");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 justify-between gap-2"
        >
          <span className="truncate">{currentLabel}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {PAPER_PRESETS.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => onChange(p.width_mm, p.height_mm)}
            className="flex items-center justify-between"
          >
            <span>{p.label}</span>
            {currentId === p.id && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            // Custom — keep current values
          }}
          className="flex items-center justify-between"
        >
          <span>Egendefinert</span>
          {currentId === "custom" && <Check className="h-4 w-4" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
