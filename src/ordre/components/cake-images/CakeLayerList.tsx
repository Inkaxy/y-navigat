import * as fabric from "fabric";
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Trash2, Unlock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CakeLayerAction = "up" | "down" | "lock" | "visible" | "delete";

type Props = {
  layers: fabric.Object[];
  active: fabric.Object | null;
  onSelect: (obj: fabric.Object) => void;
  onAction: (obj: fabric.Object, action: CakeLayerAction) => void;
};

function layerLabel(o: fabric.Object) {
  if (o instanceof fabric.Textbox || o instanceof fabric.IText) {
    return `Tekst: ${(o.text ?? "").slice(0, 18) || "tom"}`;
  }
  if (o instanceof fabric.FabricImage) return "Bilde";
  return o.type ?? "Objekt";
}

export function CakeLayerList({ layers, active, onSelect, onAction }: Props) {
  if (layers.length === 0) {
    return <p className="text-xs text-muted-foreground">Ingen lag enda.</p>;
  }
  return (
    <div className="space-y-1">
      {[...layers].reverse().map((o, i) => {
        const locked = o.selectable === false;
        return (
          <div
            key={`${o.type}-${i}`}
            className={cn(
              "flex items-center gap-1 rounded border px-2 py-1 text-xs",
              active === o ? "border-primary bg-accent" : "border-border",
            )}
          >
            <button
              type="button"
              className="flex-1 truncate text-left"
              onClick={() => onSelect(o)}
            >
              {layerLabel(o)}
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Flytt opp"
              onClick={() => onAction(o, "up")}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Flytt ned"
              onClick={() => onAction(o, "down")}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={o.visible === false ? "Vis lag" : "Skjul lag"}
              onClick={() => onAction(o, "visible")}
            >
              {o.visible === false ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={locked ? "Lås opp lag" : "Lås lag"}
              onClick={() => onAction(o, "lock")}
            >
              {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Slett lag"
              onClick={() => onAction(o, "delete")}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
