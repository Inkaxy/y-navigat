import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Square,
  Underline,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ALIGNMENTS,
  FIELD_GROUPS,
  FIELD_LABELS,
  GROUP_LABELS,
  type Alignment,
  type ProfileField,
} from "../../types";
import { clamp, round1 } from "../../lib/canvasUtils";

interface Props {
  selected: ProfileField | null;
  innerW: number;
  innerH: number;
  onChange: (patch: Partial<ProfileField>) => void;
  onRemove: () => void;
}

export function RightInspector({ selected, innerW, innerH, onChange, onRemove }: Props) {
  if (!selected) {
    return (
      <div className="flex h-full flex-col bg-card">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Ingen valgt</p>
          <p className="text-[11px] text-muted-foreground">
            Velg et felt på etiketten for å redigere det.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 text-xs text-muted-foreground">
          <p>
            Tips: dra felt fra venstre panel ut på etiketten, eller klikk for å
            legge dem til. Bruk piltaster for å flytte 1 mm, Shift+pil = 5 mm.
          </p>
        </div>
      </div>
    );
  }

  const group = FIELD_GROUPS[selected.field_type];

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-tight">
            {FIELD_LABELS[selected.field_type]}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Tekst-felt · bundet til {GROUP_LABELS[group]}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
          aria-label="Fjern fra etiketten"
          title="Fjern fra etiketten"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Position & size */}
        <Section title="Posisjon & Størrelse">
          <Row label="Posisjon">
            <UnitInput
              prefix="X"
              value={selected.x_mm}
              suffix="mm"
              onChange={(v) =>
                onChange({
                  x_mm: clamp(round1(v), 0, Math.max(0, innerW - selected.width_mm)),
                })
              }
            />
            <UnitInput
              prefix="Y"
              value={selected.y_mm}
              suffix="mm"
              onChange={(v) =>
                onChange({
                  y_mm: clamp(round1(v), 0, Math.max(0, innerH - selected.height_mm)),
                })
              }
            />
          </Row>
          <Row label="Størrelse">
            <UnitInput
              prefix="B"
              value={selected.width_mm}
              suffix="mm"
              onChange={(v) =>
                onChange({
                  width_mm: clamp(round1(v), 5, Math.max(5, innerW - selected.x_mm)),
                })
              }
            />
            <UnitInput
              prefix="H"
              value={selected.height_mm}
              suffix="mm"
              onChange={(v) =>
                onChange({
                  height_mm: clamp(round1(v), 3, Math.max(3, innerH - selected.y_mm)),
                })
              }
            />
          </Row>
        </Section>

        {/* Typography */}
        <Section title="Typografi">
          <Row label="Font">
            <div className="col-span-2 h-9 rounded-[10px] border border-border bg-muted/40 px-3 text-xs leading-9 text-muted-foreground">
              Inter
            </div>
          </Row>
          <Row label="Stil">
            <button
              type="button"
              onClick={() => onChange({ bold: !selected.bold })}
              className={cn(
                "h-9 rounded-[10px] border px-3 text-xs font-medium transition",
                selected.bold
                  ? "border-brand-bronze bg-brand-bronze/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {selected.bold ? "Bold" : "Medium"}
            </button>
            <UnitInput
              value={selected.font_size}
              onChange={(v) =>
                onChange({ font_size: Math.max(6, Math.min(48, Math.round(v))) })
              }
            />
          </Row>
          <Row label="Justering">
            <div className="col-span-2 grid grid-cols-4 rounded-[10px] border border-border bg-background p-0.5">
              {ALIGNMENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onChange({ alignment: a })}
                  className={cn(
                    "flex h-7 items-center justify-center rounded-md transition",
                    selected.alignment === a
                      ? "bg-brand-bronze/15 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-label={a}
                >
                  {alignIcon(a)}
                </button>
              ))}
              <div className="flex h-7 items-center justify-center rounded-md text-muted-foreground/40">
                <AlignJustify className="h-3.5 w-3.5" />
              </div>
            </div>
          </Row>
        </Section>

        {/* Decoration */}
        <Section title="Dekorasjon">
          <Row label="Ramme">
            <button
              type="button"
              onClick={() => onChange({ show_border: !selected.show_border })}
              className={cn(
                "flex h-9 items-center justify-center rounded-[10px] border text-xs transition",
                selected.show_border
                  ? "border-brand-bronze bg-brand-bronze/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
              title="Ramme rundt"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onChange({ show_line: !selected.show_line })}
              className={cn(
                "flex h-9 items-center justify-center rounded-[10px] border text-xs transition",
                selected.show_line
                  ? "border-brand-bronze bg-brand-bronze/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
              title="Linje under"
            >
              <Underline className="h-3.5 w-3.5" />
            </button>
          </Row>
        </Section>

        {/* Field binding (informational) */}
        <Section title="Felt-binding">
          <Row label="Kilde">
            <div className="col-span-2 flex h-9 items-center rounded-[10px] border border-border bg-muted/40 px-3 text-xs text-muted-foreground">
              {GROUP_LABELS[group]} → {FIELD_LABELS[selected.field_type]}
            </div>
          </Row>
        </Section>
      </div>
    </div>
  );
}



function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border px-4 py-4">
      <h4 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h4>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_1fr_1fr] items-center gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function UnitInput({
  prefix,
  suffix,
  value,
  onChange,
}: {
  prefix?: string;
  suffix?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex h-9 items-center gap-1 rounded-[10px] border border-border bg-background px-2 text-xs focus-within:border-brand-bronze focus-within:ring-1 focus-within:ring-brand-bronze/30">
      {prefix && (
        <span className="text-muted-foreground">{prefix}</span>
      )}
      <Input
        type="number"
        value={value}
        step={0.5}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-7 flex-1 border-0 bg-transparent p-0 text-right text-xs tabular-nums shadow-none focus-visible:ring-0"
      />
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function alignIcon(a: Alignment) {
  if (a === "center") return <AlignCenter className="h-3.5 w-3.5" />;
  if (a === "right") return <AlignRight className="h-3.5 w-3.5" />;
  return <AlignLeft className="h-3.5 w-3.5" />;
}
