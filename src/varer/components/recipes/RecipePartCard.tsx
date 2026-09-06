import { useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, MoreVertical, Copy, ArrowUp, ArrowDown, FileText, Wheat, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { RawMaterialAutocomplete } from "@/varer/components/products/RawMaterialAutocomplete";
import { useStockTrackedRawMaterials } from "@/varer/hooks/useStockTrackedRawMaterials";
import {
  PART_TYPE_OPTIONS, PREFERMENT_KIND_OPTIONS, bakersPercentFor, computePartSummary,
  fmtG, fmtPercent, gramsFromPercent, fromGrams, isFlourLine, toGrams,
  type BakersLine, type BakersRawMaterial,
} from "@/varer/lib/bakers";

const UNITS = ["g", "kg", "ml", "liter", "stk"];

export type EditorLine = BakersLine & {
  _new?: boolean;
  waste_percent: number | string;
  sort_order: number;
  notes?: string | null;
  include_in_declaration?: boolean;
  is_quid_relevant?: boolean;
  custom_declaration_text?: string | null;
};

export type EditorPart = {
  id: string;
  _new?: boolean;
  name: string;
  sort_order: number;
  instructions: string | null;
  prep_time_minutes: number | null;
  rest_time_minutes: number | null;
  part_type: string;
  preferment_kind: string | null;
  target_temp_celsius: number | null;
  ripe_time_hours: number | null;
};

interface Props {
  part: EditorPart;
  lines: EditorLine[];
  canWrite: boolean;
  totalFlourG: number;
  rmMap: Record<string, BakersRawMaterial>;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (patch: Partial<EditorPart>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddLine: () => void;
  onUpdateLine: (id: string, patch: Partial<EditorLine>) => void;
  onRemoveLine: (id: string) => void;
  onReorderLines: (partId: string, activeId: string, overId: string) => void;
  /** Oppskriften som redigeres — brukes til sirkelvern i ingrediensvelgeren. */
  currentRecipeId?: string | null;
}

export function RecipePartCard({
  part, lines, canWrite, totalFlourG, rmMap, isFirst, isLast,
  onUpdate, onRemove, onDuplicate, onMove, onAddLine, onUpdateLine, onRemoveLine, onReorderLines,
  currentRecipeId = null,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const isPreferment = part.part_type === "preferment";
  const summary = computePartSummary(lines, totalFlourG);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    onReorderLines(part.id, String(active.id), String(over.id));
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-card",
        isPreferment ? "border-app/40 bg-app/[0.04]" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
        <Input
          value={part.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          disabled={!canWrite}
          className="h-8 w-56 font-medium"
        />
        <select
          value={part.part_type}
          onChange={(e) => onUpdate({
            part_type: e.target.value,
            preferment_kind: e.target.value === "preferment" ? (part.preferment_kind ?? "fordeig") : null,
          })}
          disabled={!canWrite}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          {PART_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {isPreferment && (
          <select
            value={part.preferment_kind ?? "fordeig"}
            onChange={(e) => onUpdate({ preferment_kind: e.target.value })}
            disabled={!canWrite}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            {PREFERMENT_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <span className="text-xs text-muted-foreground">{lines.length} linjer</span>
        <div className="flex-1" />
        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onMove(-1)} disabled={isFirst}><ArrowUp className="mr-2 h-3.5 w-3.5" /> Flytt opp</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onMove(1)} disabled={isLast}><ArrowDown className="mr-2 h-3.5 w-3.5" /> Flytt ned</DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}><Copy className="mr-2 h-3.5 w-3.5" /> Dupliser</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Slett del
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {isPreferment && (
        <div className="flex flex-wrap items-end gap-3 border-b border-border/70 bg-background/40 px-3 py-2">
          <div className="w-36">
            <Label className="text-xs">Temperatur (°C)</Label>
            <Input
              type="number" step="0.5" className="h-8"
              value={part.target_temp_celsius ?? ""}
              onChange={(e) => onUpdate({ target_temp_celsius: e.target.value === "" ? null : Number(e.target.value) })}
              disabled={!canWrite}
            />
          </div>
          <div className="w-36">
            <Label className="text-xs">Modningstid (timer)</Label>
            <Input
              type="number" step="0.5" className="h-8"
              value={part.ripe_time_hours ?? ""}
              onChange={(e) => onUpdate({ ripe_time_hours: e.target.value === "" ? null : Number(e.target.value) })}
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-wrap gap-3 pb-1 text-xs text-muted-foreground">
            <span>Mel: <b className="text-foreground tabular-nums">{fmtG(summary.flourG)} g</b></span>
            <span>Hydrering: <b className="text-foreground tabular-nums">{fmtPercent(summary.hydrationPct)}</b></span>
            <span>Forfermentert mel: <b className="text-foreground tabular-nums">{fmtPercent(summary.prefermentedFlourPct)}</b></span>
          </div>
        </div>
      )}

      <div className="space-y-3 p-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={lines.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {lines.length === 0 && (
                <div className="rounded-md border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
                  Ingen linjer. Klikk «Legg til ingrediens».
                </div>
              )}
              {lines.map((l) => (
                <SortableLine
                  key={l.id}
                  line={l}
                  canWrite={canWrite}
                  totalFlourG={totalFlourG}
                  rmMap={rmMap}
                  currentRecipeId={currentRecipeId}
                  onChange={(patch) => onUpdateLine(l.id, patch)}
                  onRemove={() => onRemoveLine(l.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {canWrite && (
          <Button type="button" variant="ghost" size="sm" onClick={onAddLine}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Legg til ingrediens
          </Button>
        )}
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
          <div>
            <Label className="text-xs">Prep-tid (min)</Label>
            <Input type="number" className="h-8" value={part.prep_time_minutes ?? ""} disabled={!canWrite}
              onChange={(e) => onUpdate({ prep_time_minutes: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div>
            <Label className="text-xs">Hvile-tid (min)</Label>
            <Input type="number" className="h-8" value={part.rest_time_minutes ?? ""} disabled={!canWrite}
              onChange={(e) => onUpdate({ rest_time_minutes: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Fremgangsmåte</Label>
          <Textarea rows={2} value={part.instructions ?? ""} disabled={!canWrite}
            onChange={(e) => onUpdate({ instructions: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

function SortableLine({
  line, canWrite, totalFlourG, rmMap, currentRecipeId, onChange, onRemove,
}: {
  line: EditorLine;
  canWrite: boolean;
  totalFlourG: number;
  rmMap: Record<string, BakersRawMaterial>;
  currentRecipeId?: string | null;
  onChange: (p: Partial<EditorLine>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: line.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const { data: trackedIds } = useStockTrackedRawMaterials();
  const stockTracked = !!line.raw_material_id && !!trackedIds?.has(line.raw_material_id);
  const unmatched = !line.raw_material_id;
  const flour = isFlourLine(line);
  const computedPct = line._displayPercent ?? bakersPercentFor(line, totalFlourG);
  const showPct =
    line.entry_mode === "percent" && !flour && line.bakers_percent != null && line._displayPercent == null
      ? String(line.bakers_percent)
      : computedPct
        ? computedPct.toFixed(1)
        : "";

  function setGrams(value: string) {
    onChange({
      quantity: value,
      entry_mode: "grams",
      bakers_percent: totalFlourG > 0 ? (toGrams(value, line.unit) / totalFlourG) * 100 : null,
    });
  }

  function setPercent(value: string) {
    const pct = value === "" ? 0 : Number(value);
    const grams = gramsFromPercent(pct, totalFlourG);
    onChange({
      bakers_percent: value === "" ? null : pct,
      entry_mode: "percent",
      // Er omregningen ukjent (volum uten tetthet, stk uten stykkvekt), beholdes
      // mengden slik brukeren skrev den — vi finner ikke på et tall.
      quantity:
        totalFlourG > 0 && Number.isFinite(fromGrams(grams, line.unit))
          ? Number(fromGrams(grams, line.unit).toFixed(2))
          : line.quantity,
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        // Mobil: to rader (håndtak+råvare+slett, deretter tallfeltene) via flex + order.
        // Fra md: eksplisitt kolonnemal, slett-knappen ALLTID ytterst til høyre på linja.
        "flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5",
        "md:grid md:grid-cols-[20px_minmax(0,1fr)_96px_64px_92px_36px_76px_36px_32px]",
        unmatched ? "border-warning/40 bg-warning/5" : "border-transparent",
      )}
    >
      {canWrite ? (
        <button {...attributes} {...listeners} className="order-1 flex h-10 w-5 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing md:order-none md:h-auto">
          <GripVertical className="h-4 w-4" />
        </button>
      ) : <div className="order-1 md:order-none" />}

      <div className={cn("order-2 min-w-0 flex-1 basis-[55%] md:order-none md:flex-none md:basis-auto", (line as any).sub_product_id && "rounded-md ring-1 ring-purple-300")}>

        <RawMaterialAutocomplete
          value={line.raw_material_id}
          currentRecipeId={currentRecipeId}
          subValue={(line as any).sub_product_id ?? null}
          disabled={!canWrite}
          onChange={(id, opt) => {
            onChange({
              raw_material_id: id,
              ...(id ? { sub_product_id: null } : {}),
              ingredient_name: opt?.name ?? line.ingredient_name,
              unit: opt?.base_unit === "kg" || opt?.base_unit === "liter" ? line.unit : (opt?.base_unit ?? line.unit),
              _rm: id ? (rmMap[id] ?? { id, name: opt?.name ?? "" }) : null,
            } as never);
          }}
          onSelectSubProduct={(id, name) => {
            if (!id) {
              onChange({ sub_product_id: null } as never);
              return;
            }
            onChange({
              sub_product_id: id,
              raw_material_id: null,
              ingredient_name: name ?? line.ingredient_name,
              _rm: null,
            } as never);
          }}
          placeholder={line.ingredient_name ? `(ukoblet) ${line.ingredient_name}` : "Velg råvare…"}
        />
        {stockTracked && (
          <Badge variant="outline" className="mt-1 gap-1 text-[10px]" title="Trekkes fra lager ved kjørt pakkseddel">
            <Package className="h-3 w-3" /> Lagerføres
          </Badge>
        )}
      </div>

      {/* Tvinger radbrudd under md, slik at tallfeltene får hele bredde nummer to. */}
      <div className="order-4 basis-full md:hidden" aria-hidden />

      <div className="order-5 w-24 md:order-none md:w-auto">
        <Input
          type="number" step="any" placeholder="Gram"
          value={line.quantity}
          onChange={(e) => setGrams(e.target.value)}
          disabled={!canWrite} className="h-10 tabular-nums md:h-9"
        />
      </div>
      <div className="order-6 w-[72px] md:order-none md:w-auto">
        <select
          value={line.unit}
          onChange={(e) => onChange({ unit: e.target.value })}
          disabled={!canWrite}
          className="h-10 w-full rounded-md border border-input bg-background px-1 text-sm md:h-9"
        >
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      <div className="order-7 w-24 md:order-none md:w-auto">
        <div className="relative">
          <Input
            type="number" step="0.1" placeholder="%"
            value={showPct}
            onChange={(e) => setPercent(e.target.value)}
            disabled={!canWrite || flour || totalFlourG <= 0}
            title={flour ? "Melprosent er avledet — mel definerer nevneren" : "Bakerprosent av samlet melvekt"}
            className={cn("h-10 pr-6 tabular-nums md:h-9", flour && "bg-muted/60 text-muted-foreground")}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
        </div>
      </div>

      <div className="order-8 flex justify-center md:order-none">
        <FlourToggle line={line} flour={flour} canWrite={canWrite} onChange={onChange} />
      </div>

      <div className="order-9 w-[76px] md:order-none md:w-auto">
        <Input
          type="number" step="0.1" placeholder="Svinn"
          value={line.waste_percent ?? 0}
          onChange={(e) => onChange({ waste_percent: e.target.value })}
          disabled={!canWrite} className="h-10 tabular-nums md:h-9"
        />
      </div>

      <div className="order-10 flex justify-center md:order-none">
        <DeclarationPopover line={line} canWrite={canWrite} onChange={onChange} />
      </div>

      {canWrite ? (
        <Button
          type="button" variant="ghost" size="icon" onClick={onRemove}
          aria-label="Slett ingrediens"
          className="order-3 ml-auto h-10 w-10 md:order-none md:ml-0 md:h-8 md:w-8 md:justify-self-end"
        >
          <Trash2 className="h-4 w-4 text-muted-foreground md:h-3.5 md:w-3.5" />
        </Button>
      ) : <div className="order-3 md:order-none" />}
    </div>
  );
}


function FlourToggle({
  line, flour, canWrite, onChange,
}: { line: EditorLine; flour: boolean; canWrite: boolean; onChange: (p: Partial<EditorLine>) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button" variant="ghost" size="icon"
          className={cn("h-8 w-8", flour ? "text-app" : "text-muted-foreground/50")}
          title={flour ? "Regnes som mel" : "Regnes ikke som mel"}
        >
          <Wheat className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 space-y-3 p-3" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="text-xs font-medium text-muted-foreground">Bakerprosent-innstillinger</div>
        <div className="space-y-1">
          <Label className="text-xs">Teller som mel</Label>
          <select
            value={line.is_flour_override == null ? "auto" : line.is_flour_override ? "yes" : "no"}
            disabled={!canWrite}
            onChange={(e) => onChange({
              is_flour_override: e.target.value === "auto" ? null : e.target.value === "yes",
            })}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="auto">Automatisk (fra kornklassifisering)</option>
            <option value="yes">Ja — regn som mel</option>
            <option value="no">Nei</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Vanninnhold (%)</Label>
          <Input
            type="number" step="1" className="h-8"
            placeholder="Fra råvaren"
            value={line.water_content_pct_override ?? ""}
            disabled={!canWrite}
            onChange={(e) => onChange({ water_content_pct_override: e.target.value === "" ? null : Number(e.target.value) })}
          />
          <p className="text-[11px] text-muted-foreground">Overstyrer råvarens vanninnhold i hydreringsberegningen.</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeclarationPopover({
  line, canWrite, onChange,
}: { line: EditorLine; canWrite: boolean; onChange: (p: Partial<EditorLine>) => void }) {
  const include = line.include_in_declaration !== false;
  const isQuid = !!line.is_quid_relevant;
  const hasCustom = !!line.custom_declaration_text;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button" variant="ghost" size="icon"
          className={cn("relative h-8 w-8", !include && "text-muted-foreground/60")}
          title="Deklarasjon"
        >
          <FileText className="h-4 w-4" />
          {(isQuid || hasCustom || !include) && (
            <span className={cn(
              "absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full",
              !include ? "bg-muted-foreground" : isQuid ? "bg-app" : "bg-warning",
            )} />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 space-y-3 p-3" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="text-xs font-medium text-muted-foreground">Deklarasjonsinnstillinger</div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={include} disabled={!canWrite}
            onChange={(e) => onChange({ include_in_declaration: e.target.checked })} />
          <span>
            <span className="font-medium">Inkluder i ingrediensliste</span>
            <span className="block text-xs text-muted-foreground">Skru av for f.eks. drysse-mel.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={isQuid} disabled={!canWrite || !include}
            onChange={(e) => onChange({ is_quid_relevant: e.target.checked })} />
          <span>
            <span className="font-medium">QUID-relevant</span>
            <span className="block text-xs text-muted-foreground">Vis mengde i prosent etter ingrediensen.</span>
          </span>
        </label>
        <div>
          <Label className="text-xs">Tilpasset deklarasjonstekst</Label>
          <Input
            value={line.custom_declaration_text ?? ""}
            disabled={!canWrite || !include}
            onChange={(e) => onChange({ custom_declaration_text: e.target.value || null })}
            placeholder="Overstyr (valgfri)"
            className="h-8"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PartBadge({ type }: { type: string }) {
  const label = PART_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
  return <Badge variant="outline">{label}</Badge>;
}
