import * as fabric from "fabric";
import { FlipHorizontal, FlipVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  dpiLevel,
  fillScale,
  fitScale,
  layerDpi,
  snapAngle,
} from "@/ordre/lib/cakeEditorMath";
import {
  applyCakeFilters,
  getCakeFilters,
  type CakeFilterSettings,
} from "@/ordre/lib/cakeFilters";

type Props = {
  obj: fabric.FabricImage;
  boxW: number;
  boxH: number;
  pxPerMmValue: number;
  onLive: () => void;
  onCommit: () => void;
};

export function CakeImageLayerPanel({
  obj,
  boxW,
  boxH,
  pxPerMmValue,
  onLive,
  onCommit,
}: Props) {
  const filters = getCakeFilters(obj);
  const naturalW = obj.width ?? 0;
  const naturalH = obj.height ?? 0;
  const renderedPx = naturalW * (obj.scaleX ?? 1);
  const dpi = layerDpi({ sourcePx: naturalW, renderedPx, pxPerMm: pxPerMmValue });
  const level = dpiLevel(dpi);

  const place = (mode: "fill" | "fit" | "center") => {
    if (mode !== "center") {
      const s =
        mode === "fill"
          ? fillScale(naturalW, naturalH, boxW, boxH)
          : fitScale(naturalW, naturalH, boxW, boxH);
      obj.set({ scaleX: s, scaleY: s });
    }
    obj.set({
      originX: "center",
      originY: "center",
      left: boxW / 2,
      top: boxH / 2,
    });
    obj.setCoords();
    onLive();
    onCommit();
  };

  const setFilter = (patch: Partial<CakeFilterSettings>, commit = true) => {
    applyCakeFilters(obj, { ...filters, ...patch });
    onLive();
    if (commit) onCommit();
  };

  const slider = (
    key: keyof CakeFilterSettings,
    label: string,
    min: number,
    max: number,
  ) => (
    <div key={key}>
      <Label className="text-xs">
        {label}: {String(filters[key])}
      </Label>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[Number(filters[key])]}
        onValueChange={(v) => setFilter({ [key]: v[0] } as Partial<CakeFilterSettings>, false)}
        onValueCommit={onCommit}
      />
    </div>
  );

  return (
    // Under 1024 px skal alle knappene være minst 40 px høye (touch-mål).
    <div className="space-y-3 [&_button]:h-10 lg:[&_button]:h-8">
      <div className="text-sm font-semibold">Bildelag</div>

      <div
        className={cn(
          "rounded-md border p-2 text-xs",
          level === "lav"
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : level === "middels"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "bg-muted/40",
        )}
      >
        {dpi == null ? (
          <>Oppløsningen for dette laget er ikke målt.</>
        ) : (
          <>
            Dette laget trykkes i {dpi} DPI.{" "}
            {level === "god"
              ? "Skarpt nok for spiselig print."
              : level === "middels"
                ? "Det går, men kantene blir litt myke. Gjør laget mindre eller be om en større fil."
                : "Det blir synlig uskarpt. Gjør laget mindre, eller be kunden om en større fil."}
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1">
        <Button variant="outline" size="sm" onClick={() => place("fill")}>
          Fyll format
        </Button>
        <Button variant="outline" size="sm" onClick={() => place("fit")}>
          Tilpass
        </Button>
        <Button variant="outline" size="sm" onClick={() => place("center")}>
          Sentrer
        </Button>
      </div>

      <div>
        <Label className="text-xs">Rotasjon: {Math.round(obj.angle ?? 0)}°</Label>
        <Slider
          min={-180}
          max={180}
          step={1}
          value={[snapAngle(obj.angle ?? 0, 0)]}
          onValueChange={(v) => {
            obj.rotate(snapAngle(v[0]));
            obj.setCoords();
            onLive();
          }}
          onValueCommit={onCommit}
        />
      </div>

      <div className="flex gap-1">
        <Button
          variant={obj.flipX ? "default" : "outline"}
          size="sm"
          aria-label="Speil vannrett"
          onClick={() => {
            obj.set("flipX", !obj.flipX);
            onLive();
            onCommit();
          }}
        >
          <FlipHorizontal className="h-4 w-4" />
        </Button>
        <Button
          variant={obj.flipY ? "default" : "outline"}
          size="sm"
          aria-label="Speil loddrett"
          onClick={() => {
            obj.set("flipY", !obj.flipY);
            onLive();
            onCommit();
          }}
        >
          <FlipVertical className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      <div className="space-y-2">
        {slider("brightness", "Lysstyrke", -100, 100)}
        {slider("contrast", "Kontrast", -100, 100)}
        {slider("saturation", "Metning", -100, 100)}
        {slider("sharpen", "Skarphet", 0, 100)}
        {slider("temperature", "Varme", -100, 100)}
        <div className="flex flex-wrap gap-1">
          <Button
            variant={filters.grayscale ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter({ grayscale: !filters.grayscale })}
          >
            Gråtoner
          </Button>
          <Button
            variant={filters.removeWhite ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter({ removeWhite: !filters.removeWhite })}
          >
            Fjern hvit bakgrunn
          </Button>
        </div>
        {filters.removeWhite && (
          <div>
            <Label className="text-xs">
              Terskel: {filters.removeWhiteThreshold}%
            </Label>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[filters.removeWhiteThreshold]}
              onValueChange={(v) => setFilter({ removeWhiteThreshold: v[0] }, false)}
              onValueCommit={onCommit}
            />
          </div>
        )}
      </div>
    </div>
  );
}
