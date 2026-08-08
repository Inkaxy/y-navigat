import { Minus, Plus, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ProfileField } from "../../types";
import { useLabelFieldCatalog } from "../../hooks/useLabelFieldCatalog";
import { round1 } from "../../lib/canvasUtils";

interface Props {
  placedCount: number;
  selected: ProfileField | null;
  zoomPct: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export function StatusBar({
  placedCount,
  selected,
  zoomPct,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: Props) {
  return (
    <div className="flex h-8 items-center gap-4 border-t border-border bg-muted/30 px-4 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {placedCount} felt på etiketten
      </span>
      {selected && (
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground/60">Valgt:</span>
          <span className="font-medium text-foreground">
            {catalog.label(selected.field_type)}
          </span>
        </span>
      )}
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded-sm border border-border bg-background" />
        Snap på · 1 mm raster
      </span>
      <div className="ml-auto flex items-center gap-3">
        {selected && (
          <span className="tabular-nums">
            Pos {round1(selected.x_mm)}, {round1(selected.y_mm)} mm
          </span>
        )}
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onZoomOut}
            aria-label="Zoom ut"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="w-10 text-center tabular-nums">{zoomPct}%</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onZoomIn}
            aria-label="Zoom inn"
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onZoomReset}
            aria-label="Tilbakestill"
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
