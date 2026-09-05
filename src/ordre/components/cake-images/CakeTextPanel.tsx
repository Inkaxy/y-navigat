import * as fabric from "fabric";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { CakeFontPicker } from "@/ordre/components/cake-images/CakeFontPicker";
import { loadCakeFont } from "@/ordre/lib/cakeFonts";
import { curvedTextArc } from "@/ordre/lib/cakeEditorMath";

export type CakeCurvedText = fabric.Textbox & {
  cakeCurveRadius?: number;
  cakeCurveDirection?: "up" | "down";
};

/** Legg/fjern buen på en tekst. Radius 0 = rett tekst. */
export function applyTextCurve(
  obj: CakeCurvedText,
  radius: number,
  direction: "up" | "down",
) {
  obj.cakeCurveRadius = radius;
  obj.cakeCurveDirection = direction;
  if (!radius) {
    obj.set({ path: undefined });
    return;
  }
  const width = Math.max(10, obj.width ?? 100);
  const arc = curvedTextArc(radius, width, direction);
  const path = new fabric.Path(arc.d, {
    fill: "",
    stroke: "",
    objectCaching: false,
  });
  obj.set({ path, pathSide: "left", pathAlign: "center" });
}

type Props = {
  obj: CakeCurvedText;
  /** Tegn på nytt uten å ta et angre-punkt (mens brukeren drar). */
  onLive: () => void;
  /** Endringen er ferdig — ta et angre-punkt. */
  onCommit: () => void;
};

export function CakeTextPanel({ obj, onLive, onCommit }: Props) {
  const set = (patch: Record<string, unknown>, commit = true) => {
    obj.set(patch as never);
    obj.setCoords();
    onLive();
    if (commit) onCommit();
  };

  const shadow = obj.shadow as fabric.Shadow | null;
  const curveRadius = obj.cakeCurveRadius ?? 0;
  const curveDir = obj.cakeCurveDirection ?? "up";

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">Tekst</div>

      <Textarea
        value={obj.text ?? ""}
        rows={2}
        onChange={(e) => set({ text: e.target.value }, false)}
        onBlur={onCommit}
        className="text-sm"
      />

      <div>
        <Label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
          Skrifttype
        </Label>
        <CakeFontPicker
          compact
          value={(obj.fontFamily as string) ?? "Inter"}
          onChange={(family) => {
            void loadCakeFont(family).then(() => set({ fontFamily: family }));
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant={obj.fontWeight === "bold" ? "default" : "outline"}
          size="sm"
          aria-label="Fet"
          onClick={() => set({ fontWeight: obj.fontWeight === "bold" ? "normal" : "bold" })}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          variant={obj.fontStyle === "italic" ? "default" : "outline"}
          size="sm"
          aria-label="Kursiv"
          onClick={() => set({ fontStyle: obj.fontStyle === "italic" ? "normal" : "italic" })}
        >
          <Italic className="h-4 w-4" />
        </Button>
        {(
          [
            ["left", AlignLeft, "Venstrestilt"],
            ["center", AlignCenter, "Midtstilt"],
            ["right", AlignRight, "Høyrestilt"],
          ] as const
        ).map(([value, Icon, label]) => (
          <Button
            key={value}
            variant={obj.textAlign === value ? "default" : "outline"}
            size="sm"
            aria-label={label}
            onClick={() => set({ textAlign: value })}
          >
            <Icon className="h-4 w-4" />
          </Button>
        ))}
        <Input
          type="color"
          aria-label="Tekstfarge"
          value={(obj.fill as string) ?? "#1f1b16"}
          onChange={(e) => set({ fill: e.target.value }, false)}
          onBlur={onCommit}
          className="h-10 w-12 p-1"
        />
      </div>

      <div>
        <Label className="text-xs">Størrelse: {Math.round(obj.fontSize ?? 0)}</Label>
        <Slider
          min={10}
          max={400}
          step={1}
          value={[obj.fontSize ?? 40]}
          onValueChange={(v) => set({ fontSize: v[0] }, false)}
          onValueCommit={onCommit}
        />
      </div>

      <div>
        <Label className="text-xs">
          Linjeavstand: {(obj.lineHeight ?? 1.16).toFixed(2)}
        </Label>
        <Slider
          min={0.6}
          max={2.5}
          step={0.02}
          value={[obj.lineHeight ?? 1.16]}
          onValueChange={(v) => set({ lineHeight: v[0] }, false)}
          onValueCommit={onCommit}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="text-xs font-semibold">Kontur</div>
        <div className="flex items-center gap-2">
          <Input
            type="color"
            aria-label="Konturfarge"
            value={(obj.stroke as string) ?? "#ffffff"}
            onChange={(e) => set({ stroke: e.target.value }, false)}
            onBlur={onCommit}
            className="h-10 w-12 p-1"
          />
          <div className="flex-1">
            <Label className="text-xs">Tykkelse: {obj.strokeWidth ?? 0}</Label>
            <Slider
              min={0}
              max={20}
              step={0.5}
              value={[obj.strokeWidth ?? 0]}
              onValueChange={(v) =>
                set(
                  {
                    strokeWidth: v[0],
                    stroke: (obj.stroke as string) ?? "#ffffff",
                    paintFirst: "stroke",
                  },
                  false,
                )
              }
              onValueCommit={onCommit}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold">Skygge</div>
        <div className="flex items-center gap-2">
          <Button
            variant={shadow ? "default" : "outline"}
            size="sm"
            onClick={() =>
              set({
                shadow: shadow
                  ? null
                  : new fabric.Shadow({
                      color: "rgba(0,0,0,0.45)",
                      blur: 18,
                      offsetX: 6,
                      offsetY: 6,
                    }),
              })
            }
          >
            {shadow ? "Skygge på" : "Legg til skygge"}
          </Button>
          {shadow && (
            <div className="flex-1">
              <Label className="text-xs">Mykhet: {Math.round(shadow.blur)}</Label>
              <Slider
                min={0}
                max={60}
                step={1}
                value={[shadow.blur]}
                onValueChange={(v) => {
                  shadow.blur = v[0];
                  onLive();
                }}
                onValueCommit={onCommit}
              />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold">Bakgrunnsplate</div>
        <div className="flex items-center gap-2">
          <Button
            variant={obj.backgroundColor ? "default" : "outline"}
            size="sm"
            onClick={() =>
              set({ backgroundColor: obj.backgroundColor ? "" : "#ffffff" })
            }
          >
            {obj.backgroundColor ? "Plate på" : "Legg til plate"}
          </Button>
          {obj.backgroundColor && (
            <Input
              type="color"
              aria-label="Platefarge"
              value={(obj.backgroundColor as string) ?? "#ffffff"}
              onChange={(e) => set({ backgroundColor: e.target.value }, false)}
              onBlur={onCommit}
              className="h-10 w-12 p-1"
            />
          )}
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="text-xs font-semibold">Buet tekst</div>
        <Label className="text-xs">
          {curveRadius ? `Radius: ${curveRadius} px` : "Rett tekst"}
        </Label>
        <Slider
          min={0}
          max={3000}
          step={25}
          value={[curveRadius]}
          onValueChange={(v) => {
            applyTextCurve(obj, v[0], curveDir);
            onLive();
          }}
          onValueCommit={onCommit}
        />
        <div className="flex gap-1">
          <Button
            variant={curveDir === "up" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              applyTextCurve(obj, curveRadius, "up");
              onLive();
              onCommit();
            }}
          >
            Bue opp
          </Button>
          <Button
            variant={curveDir === "down" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              applyTextCurve(obj, curveRadius, "down");
              onLive();
              onCommit();
            }}
          >
            Bue ned
          </Button>
        </div>
      </div>
    </div>
  );
}
