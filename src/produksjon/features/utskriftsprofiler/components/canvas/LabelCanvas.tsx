import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  FIELD_LABELS,
  type FieldType,
  type ProfileField,
  defaultFieldSize,
} from "../../types";
import { clamp, getInnerArea, round1, snap } from "../../lib/canvasUtils";

interface Props {
  paperWidth: number;
  paperHeight: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  landscape: boolean;
  fields: ProfileField[];
  selectedFieldType: FieldType | null;
  companyName: string;
  logoUrl: string | null;
  includeFieldLabels: boolean;
  onSelectField: (type: FieldType | null) => void;
  onUpdateField: (type: FieldType, patch: Partial<ProfileField>) => void;
  onAddFieldAt: (type: FieldType, x: number, y: number) => void;
  /** Optional inline toolbar to render anchored above selected field. */
  renderInlineToolbar?: (field: ProfileField) => React.ReactNode;
  /** Read-only mode for thumbnails / preview. */
  readOnly?: boolean;
  /** Override pixels-per-mm. Default: zoomable interactive canvas. */
  fixedPxPerMm?: number;
  /** Controlled zoom (px per mm). */
  zoom?: number;
  /** Show rulers at top + left. */
  showRulers?: boolean;
}

type DragMode =
  | { kind: "move"; type: FieldType; startX: number; startY: number; origX: number; origY: number }
  | { kind: "resize"; type: FieldType; handle: ResizeHandle; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number };

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const HANDLES: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function LabelCanvas(props: Props) {
  const {
    paperWidth,
    paperHeight,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    landscape,
    fields,
    selectedFieldType,
    companyName,
    logoUrl,
    includeFieldLabels,
    onSelectField,
    onUpdateField,
    onAddFieldAt,
    renderInlineToolbar,
    readOnly = false,
    fixedPxPerMm,
  } = props;

  const inner = getInnerArea(
    paperWidth,
    paperHeight,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    landscape,
  );
  const paperW = landscape ? paperWidth : paperHeight;
  const paperH = landscape ? paperHeight : paperWidth;

  const internalZoom = props.zoom ?? 4;
  const pxPerMm = fixedPxPerMm ?? internalZoom;

  const innerRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const [hovering, setHovering] = useState(false);

  const includedFields = useMemo(
    () => fields.filter((f) => f.include).sort((a, b) => a.z_index - b.z_index),
    [fields],
  );

  // === overlap detection ===
  const overlappingTypes = useMemo(() => {
    const set = new Set<FieldType>();
    for (let i = 0; i < includedFields.length; i++) {
      const a = includedFields[i];
      for (let j = i + 1; j < includedFields.length; j++) {
        const b = includedFields[j];
        const overlap =
          a.x_mm < b.x_mm + b.width_mm &&
          a.x_mm + a.width_mm > b.x_mm &&
          a.y_mm < b.y_mm + b.height_mm &&
          a.y_mm + a.height_mm > b.y_mm;
        if (overlap) {
          set.add(a.field_type);
          set.add(b.field_type);
        }
      }
    }
    return set;
  }, [includedFields]);

  // === alignment guides while dragging ===
  const guides = useMemo(() => {
    if (!dragMode) return { v: [] as number[], h: [] as number[] };
    const active = fields.find((f) => f.field_type === dragMode.type);
    if (!active) return { v: [], h: [] };
    const v: number[] = [];
    const h: number[] = [];
    const aEdgesX = [active.x_mm, active.x_mm + active.width_mm / 2, active.x_mm + active.width_mm];
    const aEdgesY = [active.y_mm, active.y_mm + active.height_mm / 2, active.y_mm + active.height_mm];
    for (const f of includedFields) {
      if (f.field_type === active.field_type) continue;
      const bx = [f.x_mm, f.x_mm + f.width_mm / 2, f.x_mm + f.width_mm];
      const by = [f.y_mm, f.y_mm + f.height_mm / 2, f.y_mm + f.height_mm];
      for (const a of aEdgesX) for (const b of bx) if (Math.abs(a - b) < 0.6) v.push(b);
      for (const a of aEdgesY) for (const b of by) if (Math.abs(a - b) < 0.6) h.push(b);
    }
    return { v, h };
  }, [dragMode, fields, includedFields]);

  // === pointer drag ===
  useEffect(() => {
    if (!dragMode) return;
    const onMove = (e: PointerEvent) => {
      const dxPx = e.clientX - dragMode.startX;
      const dyPx = e.clientY - dragMode.startY;
      const dxMm = dxPx / pxPerMm;
      const dyMm = dyPx / pxPerMm;
      const f = fields.find((x) => x.field_type === dragMode.type);
      if (!f) return;

      if (dragMode.kind === "move") {
        const nx = clamp(dragMode.origX + dxMm, 0, Math.max(0, inner.w - f.width_mm));
        const ny = clamp(dragMode.origY + dyMm, 0, Math.max(0, inner.h - f.height_mm));
        const snapStep = e.shiftKey ? 0.5 : 1;
        onUpdateField(dragMode.type, {
          x_mm: round1(snap(nx, snapStep)),
          y_mm: round1(snap(ny, snapStep)),
        });
      } else {
        let { origX, origY, origW, origH } = dragMode;
        let nx = origX, ny = origY, nw = origW, nh = origH;
        const minSize = 5;
        if (dragMode.handle.includes("e")) nw = clamp(origW + dxMm, minSize, inner.w - origX);
        if (dragMode.handle.includes("s")) nh = clamp(origH + dyMm, minSize, inner.h - origY);
        if (dragMode.handle.includes("w")) {
          const newW = clamp(origW - dxMm, minSize, origX + origW);
          nx = origX + (origW - newW);
          nw = newW;
        }
        if (dragMode.handle.includes("n")) {
          const newH = clamp(origH - dyMm, minSize, origY + origH);
          ny = origY + (origH - newH);
          nh = newH;
        }
        const snapStep = e.shiftKey ? 0.5 : 1;
        onUpdateField(dragMode.type, {
          x_mm: round1(snap(nx, snapStep)),
          y_mm: round1(snap(ny, snapStep)),
          width_mm: round1(snap(nw, snapStep)),
          height_mm: round1(snap(nh, snapStep)),
        });
      }
    };
    const onUp = () => setDragMode(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragMode, fields, inner.w, inner.h, onUpdateField, pxPerMm]);

  // === keyboard nudge ===
  useEffect(() => {
    if (readOnly || !selectedFieldType) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept while typing in an input
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const f = fields.find((x) => x.field_type === selectedFieldType);
      if (!f) return;
      const step = e.shiftKey ? 5 : 1;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onUpdateField(selectedFieldType, { include: false });
        onSelectField(null);
        return;
      } else return;
      e.preventDefault();
      onUpdateField(selectedFieldType, {
        x_mm: clamp(round1(f.x_mm + dx), 0, Math.max(0, inner.w - f.width_mm)),
        y_mm: clamp(round1(f.y_mm + dy), 0, Math.max(0, inner.h - f.height_mm)),
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, selectedFieldType, fields, inner.w, inner.h, onUpdateField, onSelectField]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setHovering(false);
      const type = e.dataTransfer.getData("text/x-field-type") as FieldType;
      if (!type) return;
      const rect = innerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sz = defaultFieldSize(type);
      const xMm = clamp((e.clientX - rect.left) / pxPerMm - sz.w / 2, 0, Math.max(0, inner.w - sz.w));
      const yMm = clamp((e.clientY - rect.top) / pxPerMm - sz.h / 2, 0, Math.max(0, inner.h - sz.h));
      onAddFieldAt(type, round1(xMm), round1(yMm));
    },
    [pxPerMm, inner.w, inner.h, onAddFieldAt],
  );

  const selected = selectedFieldType
    ? includedFields.find((f) => f.field_type === selectedFieldType) ?? null
    : null;

  return (
    <div className="flex h-full flex-col">
      {!readOnly && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card/40 px-4 py-1.5 text-[11px] text-muted-foreground">
          <span>
            {overlappingTypes.size > 0 ? (
              <span className="font-medium text-destructive">
                ⚠ {overlappingTypes.size} felt overlapper – juster plassering
              </span>
            ) : (
              <span>Tips: dra felt for justeringslinjer · rutenett = 1 mm</span>
            )}
          </span>
          <span>
            Etikett: {paperW} × {paperH} mm · innhold {round1(inner.w)} × {round1(inner.h)} mm
          </span>
        </div>
      )}

      <div
        className={cn(
          "relative flex-1 overflow-auto",
          readOnly ? "bg-transparent" : "bg-[hsl(var(--muted)/0.4)]",
        )}
      >
        <div
          className="flex min-h-full min-w-full items-center justify-center p-6"
          onClick={() => !readOnly && onSelectField(null)}
        >
          {/* Paper */}
          <div
            className={cn(
              "relative shadow-md",
              "bg-white",
              hovering ? "ring-2 ring-primary" : "ring-1 ring-border",
            )}
            style={{
              width: paperW * pxPerMm,
              height: paperH * pxPerMm,
              paddingTop: marginTop * pxPerMm,
              paddingRight: marginRight * pxPerMm,
              paddingBottom: marginBottom * pxPerMm,
              paddingLeft: marginLeft * pxPerMm,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Inner content area */}
            <div
              ref={innerRef}
              className={cn(
                "relative h-full w-full",
                !readOnly &&
                  "outline outline-1 outline-dashed outline-border/60",
              )}
              style={
                !readOnly
                  ? {
                      backgroundImage:
                        "linear-gradient(to right, hsl(var(--border) / 0.25) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.25) 1px, transparent 1px)",
                      backgroundSize: `${pxPerMm * 5}px ${pxPerMm * 5}px`,
                    }
                  : undefined
              }
              onDragOver={(e) => {
                if (readOnly) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setHovering(true);
              }}
              onDragLeave={() => setHovering(false)}
              onDrop={readOnly ? undefined : handleDrop}
            >
              {includedFields.map((f) => {
                const isSelected = !readOnly && f.field_type === selectedFieldType;
                const isOverlapping = !readOnly && overlappingTypes.has(f.field_type);
                return (
                  <CanvasFieldBox
                    overlapping={isOverlapping}
                    key={f.field_type}
                    field={f}
                    pxPerMm={pxPerMm}
                    selected={isSelected}
                    readOnly={readOnly}
                    companyName={companyName}
                    logoUrl={logoUrl}
                    includeFieldLabels={includeFieldLabels}
                    onPointerDownMove={(e) => {
                      if (readOnly) return;
                      e.stopPropagation();
                      onSelectField(f.field_type);
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      setDragMode({
                        kind: "move",
                        type: f.field_type,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: f.x_mm,
                        origY: f.y_mm,
                      });
                    }}
                    onPointerDownResize={(handle, e) => {
                      if (readOnly) return;
                      e.stopPropagation();
                      onSelectField(f.field_type);
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      setDragMode({
                        kind: "resize",
                        type: f.field_type,
                        handle,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: f.x_mm,
                        origY: f.y_mm,
                        origW: f.width_mm,
                        origH: f.height_mm,
                      });
                    }}
                  />
                );
              })}

              {/* Inline toolbar anchored above selected field */}
              {!readOnly && selected && renderInlineToolbar && (
                <div
                  className="pointer-events-none absolute z-50"
                  style={{
                    left: selected.x_mm * pxPerMm,
                    top: Math.max(0, selected.y_mm * pxPerMm - 40),
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {renderInlineToolbar(selected)}
                </div>
              )}

              {!readOnly && includedFields.length === 0 && (
                <div className="flex h-full w-full items-center justify-center">
                  <p className="select-none text-center text-xs text-muted-foreground">
                    Dra felt fra panelet til venstre
                    <br />
                    eller klikk på et felt for å legge det til
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function CoordinateBar({
  field,
  maxW,
  maxH,
  onChange,
}: {
  field: ProfileField;
  maxW: number;
  maxH: number;
  onChange: (patch: Partial<ProfileField>) => void;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="font-medium">{FIELD_LABELS[field.field_type]}</span>
      <span className="text-muted-foreground">·</span>
      <CoordInput label="X" value={field.x_mm} onChange={(v) => onChange({ x_mm: clamp(v, 0, maxW - field.width_mm) })} />
      <CoordInput label="Y" value={field.y_mm} onChange={(v) => onChange({ y_mm: clamp(v, 0, maxH - field.height_mm) })} />
      <CoordInput label="B" value={field.width_mm} onChange={(v) => onChange({ width_mm: clamp(v, 5, maxW - field.x_mm) })} />
      <CoordInput label="H" value={field.height_mm} onChange={(v) => onChange({ height_mm: clamp(v, 3, maxH - field.y_mm) })} />
      <span className="ml-auto text-muted-foreground">mm</span>
    </div>
  );
}

function CoordInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        step={0.5}
        onChange={(e) => onChange(round1(Number(e.target.value) || 0))}
        className="h-6 w-14 rounded border border-input bg-background px-1.5 text-right text-xs tabular-nums"
      />
    </label>
  );
}

interface CanvasFieldBoxProps {
  field: ProfileField;
  pxPerMm: number;
  selected: boolean;
  readOnly: boolean;
  companyName: string;
  logoUrl: string | null;
  includeFieldLabels: boolean;
  onPointerDownMove: (e: React.PointerEvent) => void;
  onPointerDownResize: (handle: ResizeHandle, e: React.PointerEvent) => void;
}

function CanvasFieldBox({
  field,
  pxPerMm,
  selected,
  readOnly,
  companyName,
  logoUrl,
  includeFieldLabels,
  onPointerDownMove,
  onPointerDownResize,
}: CanvasFieldBoxProps) {
  const fontPx = Math.max(6, field.font_size * pxPerMm * 0.32);

  let content: React.ReactNode;
  if (field.field_type === "logo" && logoUrl) {
    content = (
      <img
        src={logoUrl}
        alt=""
        className="pointer-events-none h-full w-full object-contain"
      />
    );
  } else if (field.field_type === "firmanavn") {
    content = companyName || FIELD_LABELS.firmanavn;
  } else if (field.field_type === "etikett_nr") {
    content = "1000";
  } else if (field.field_type === "tur") {
    content = "Tur 1";
  } else if (field.field_type === "hentested") {
    content = "Teie";
  } else if (field.field_type === "telefon") {
    content = "+47 999 99 999";
  } else if (field.field_type === "leveringsdato") {
    content = "02.06.2026";
  } else {
    content = `[${FIELD_LABELS[field.field_type]}]`;
  }

  return (
    <div
      onPointerDown={onPointerDownMove}
      className={cn(
        "absolute select-none overflow-hidden",
        readOnly ? "cursor-default" : "cursor-move",
        selected && !readOnly && "ring-2 ring-primary",
        !selected && !readOnly && "hover:ring-1 hover:ring-primary/50",
      )}
      style={{
        left: field.x_mm * pxPerMm,
        top: field.y_mm * pxPerMm,
        width: field.width_mm * pxPerMm,
        height: field.height_mm * pxPerMm,
        zIndex: field.z_index,
        border: field.show_border ? "1px solid #777" : undefined,
        borderBottom:
          field.show_line && !field.show_border ? "1px solid #777" : undefined,
        background: selected && !readOnly ? "hsl(var(--primary) / 0.05)" : undefined,
      }}
    >
      <div
        className="flex h-full w-full items-center px-0.5"
        style={{
          fontSize: fontPx,
          fontWeight: field.bold ? 700 : 400,
          justifyContent:
            field.alignment === "center"
              ? "center"
              : field.alignment === "right"
                ? "flex-end"
                : "flex-start",
          textAlign: field.alignment,
          lineHeight: 1.1,
        }}
      >
        <span className="truncate">
          {includeFieldLabels && (field.show_label ?? true) && field.field_type !== "logo" && (
            <span className="text-muted-foreground">
              {FIELD_LABELS[field.field_type]}:{" "}
            </span>
          )}
          {content}
        </span>
      </div>

      {selected && !readOnly && (
        <>
          {HANDLES.map((h) => (
            <div
              key={h}
              onPointerDown={(e) => onPointerDownResize(h, e)}
              className={cn(
                "absolute h-2 w-2 rounded-sm border border-primary bg-background",
                handleClass(h),
              )}
              style={{ touchAction: "none" }}
            />
          ))}
        </>
      )}
    </div>
  );
}

function handleClass(h: ResizeHandle): string {
  const map: Record<ResizeHandle, string> = {
    n: "left-1/2 -top-1 -translate-x-1/2 cursor-n-resize",
    s: "left-1/2 -bottom-1 -translate-x-1/2 cursor-s-resize",
    e: "-right-1 top-1/2 -translate-y-1/2 cursor-e-resize",
    w: "-left-1 top-1/2 -translate-y-1/2 cursor-w-resize",
    ne: "-right-1 -top-1 cursor-ne-resize",
    nw: "-left-1 -top-1 cursor-nw-resize",
    se: "-right-1 -bottom-1 cursor-se-resize",
    sw: "-left-1 -bottom-1 cursor-sw-resize",
  };
  return map[h];
}
