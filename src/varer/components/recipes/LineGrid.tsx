/**
 * Regneark-lignende ingrediensgrid — erstatning for 4-klikks-flyten i
 * `RecipePartCard`. Selvstendig komponent, koblet inn av en annen utvikler.
 */
import { memo, useCallback, useMemo } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RawMaterialOption } from "@/varer/components/products/RawMaterialAutocomplete";
import { LineNameCell, LineNumberCell } from "@/varer/components/recipes/LineCell";
import { useLineGridKeys, type GridColumn, type GridFocus } from "@/varer/hooks/useLineGridKeys";
import {
  bakersPercentFor, gramsFromPercent, isFlourLine, isLineConvertible, lineFromGrams, lineToGrams,
  type BakersRawMaterial,
} from "@/varer/lib/bakers";
import type { EditorLine } from "@/varer/components/recipes/RecipePartCard";

const UNITS = ["g", "kg", "ml", "liter", "stk"];

export interface LineGridProps {
  partId: string;
  lines: EditorLine[];
  canWrite: boolean;
  totalFlourG: number;
  rmMap: Record<string, BakersRawMaterial>;
  /** Delens registreringsmodus. I "percent" er %-feltet primært og gram er avledet. */
  entryMode: "grams" | "percent";
  currentRecipeId?: string | null;
  /** Advarselstekst per linje-id, vises som markør på raden. */
  warningsByLine?: Record<string, string | undefined>;
  onUpdateLine: (id: string, patch: Partial<EditorLine>) => void;
  onRemoveLine: (id: string) => void;
  onReorderLines: (partId: string, activeId: string, overId: string) => void;
  /** Legger til en ny linje og returnerer id-en, slik at griddet kan fokusere den. */
  onAddLine: () => string | null;
  /** Ekstra innhold ytterst til høyre på raden (melbryter, deklarasjon). */
  renderRowExtras?: (line: EditorLine) => React.ReactNode;
}

export function LineGrid({
  partId, lines, canWrite, totalFlourG, rmMap, entryMode, currentRecipeId = null,
  warningsByLine, onUpdateLine, onRemoveLine, onReorderLines, onAddLine, renderRowExtras,
}: LineGridProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const lineIds = useMemo(() => lines.map((l) => l.id), [lines]);

  const focusCell = useCallback((focus: GridFocus) => {
    // DOM-en eies av cellene selv (autoFocus via ref); griddet trenger bare
    // en unik data-nøkkel per (rad, kolonne) som cellene lytter på ved re-render.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-grid-cell="${focus.lineId}:${focus.column}"] input`,
      );
      el?.focus();
    });
  }, []);

  const { focus, setFocus, handleKeyDown } = useLineGridKeys({
    lineIds,
    onFocusChange: focusCell,
    onAppendLine: onAddLine,
  });

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    onReorderLines(partId, String(active.id), String(over.id));
  }

  function handleAppendAndFocus() {
    const id = onAddLine();
    if (id) {
      setFocus({ lineId: id, column: "name" });
      focusCell({ lineId: id, column: "name" });
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="hidden gap-2 px-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[20px_minmax(0,1fr)_96px_64px_92px_36px_76px_36px_32px]">
        <div />
        <div>Ingrediens</div>
        <div>Mengde</div>
        <div>Enhet</div>
        <div>%</div>
        <div />
        <div>Svinn</div>
        <div />
        <div />
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={lineIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {lines.length === 0 && (
              <div className="rounded-md border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
                Ingen linjer. Klikk «Legg til ingrediens».
              </div>
            )}
            {lines.map((line) => (
              <GridRow
                key={line.id}
                line={line}
                canWrite={canWrite}
                totalFlourG={totalFlourG}
                rmMap={rmMap}
                entryMode={entryMode}
                currentRecipeId={currentRecipeId}
                warning={warningsByLine?.[line.id]}
                focus={focus}
                onFocus={setFocus}
                onKeyDown={handleKeyDown}
                onChange={(patch) => onUpdateLine(line.id, patch)}
                onRemove={() => onRemoveLine(line.id)}
                renderRowExtras={renderRowExtras}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {canWrite && (
        <Button type="button" variant="ghost" size="sm" onClick={handleAppendAndFocus}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Legg til ingrediens
        </Button>
      )}
    </div>
  );
}

interface GridRowProps {
  line: EditorLine;
  canWrite: boolean;
  totalFlourG: number;
  rmMap: Record<string, BakersRawMaterial>;
  entryMode: "grams" | "percent";
  currentRecipeId?: string | null;
  warning?: string;
  focus: GridFocus | null;
  onFocus: (focus: GridFocus) => void;
  onKeyDown: (focus: GridFocus) => (e: React.KeyboardEvent) => void;
  onChange: (patch: Partial<EditorLine>) => void;
  onRemove: () => void;
  renderRowExtras?: (line: EditorLine) => React.ReactNode;
}

function areEqual(prev: GridRowProps, next: GridRowProps): boolean {
  return (
    prev.line === next.line &&
    prev.totalFlourG === next.totalFlourG &&
    prev.entryMode === next.entryMode &&
    prev.canWrite === next.canWrite &&
    prev.warning === next.warning &&
    // Fokus flytter mange rader — vi bryr oss kun om denne raden er involvert.
    prev.focus?.lineId === next.focus?.lineId &&
    prev.focus?.column === next.focus?.column
  );
}

const GridRow = memo(function GridRow({
  line, canWrite, totalFlourG, rmMap, entryMode, currentRecipeId = null, warning,
  focus, onFocus, onKeyDown, onChange, onRemove, renderRowExtras,
}: GridRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: line.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const unmatched = !line.raw_material_id && !line.sub_product_id;
  const flour = isFlourLine(line);
  const computedPct = line._displayPercent ?? bakersPercentFor(line, totalFlourG);
  const showPct =
    line.entry_mode === "percent" && !flour && line.bakers_percent != null && line._displayPercent == null
      ? String(line.bakers_percent)
      : computedPct
        ? computedPct.toFixed(1)
        : "";

  /** Sann når linjens enhet faktisk kan regnes om til gram — begge veier. */
  const convertible = isLineConvertible(line);
  const conversion = lineToGrams(line);
  const conversionWarning = conversion.exact
    ? null
    : conversion.reason ?? "Mengden kan ikke regnes om til gram";

  function setGrams(value: string) {
    const conv = lineToGrams({ ...line, quantity: value });
    onChange({
      quantity: value,
      entry_mode: "grams",
      // Er omregningen ukjent, lagrer vi INGEN bakerprosent — et tall her ville
      // motsagt mengden brukeren skrev.
      bakers_percent: conv.exact && totalFlourG > 0 ? (conv.grams / totalFlourG) * 100 : null,
    });
  }

  function setPercent(value: string) {
    // Uten kjent omregning kan prosent ikke oversettes til en mengde. Feltet er
    // deaktivert i den situasjonen, men vi vokter også her.
    if (!convertible || totalFlourG <= 0) return;
    const pct = value === "" ? 0 : Number(value);
    const quantity = lineFromGrams(gramsFromPercent(pct, totalFlourG), line);
    if (!Number.isFinite(quantity)) return;
    onChange({
      bakers_percent: value === "" ? null : pct,
      entry_mode: "percent",
      quantity: value === "" ? line.quantity : Number(quantity.toFixed(3)),
    });
  }

  const percentPrimary = entryMode === "percent";
  const cellKey = (column: GridColumn) => `${line.id}:${column}`;
  const cellFocused = (column: GridColumn) => focus?.lineId === line.id && focus.column === column;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5",
        "md:grid md:grid-cols-[20px_minmax(0,1fr)_96px_64px_92px_36px_76px_36px_32px]",
        unmatched ? "border-warning/40 bg-warning/5" : "border-transparent",
      )}
    >
      {canWrite ? (
        <button
          {...attributes}
          {...listeners}
          className="order-1 flex h-10 w-5 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing md:order-none md:h-auto"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <div className="order-1 md:order-none" />
      )}

      <div
        className="order-2 min-w-0 flex-1 basis-[55%] md:order-none md:flex-none md:basis-auto"
        data-grid-cell={cellKey("name")}
      >
        <div className="mb-0.5 text-[11px] text-muted-foreground md:hidden">Ingrediens</div>
        <LineNameCell
          value={line.raw_material_id}
          ingredientName={line.ingredient_name ?? null}
          subProductId={line.sub_product_id ?? null}
          disabled={!canWrite}
          currentRecipeId={currentRecipeId}
          autoFocus={cellFocused("name")}
          onSelect={(id, opt) => {
            onChange({
              raw_material_id: id,
              ...(id ? { sub_product_id: null } : {}),
              ingredient_name: opt?.name ?? line.ingredient_name,
              // Baseenheten heter «l» i den kanoniske lista — ikke «liter».
              unit: opt?.base_unit === "kg" || opt?.base_unit === "l" ? line.unit : (opt?.base_unit ?? line.unit),
              _rm: id ? (rmMap[id] ?? { id, name: opt?.name ?? "" }) : null,
            } as never);
          }}
          onKeyDown={onKeyDown({ lineId: line.id, column: "name" })}
        />
      </div>

      <div className="order-4 basis-full md:hidden" aria-hidden />

      <div className="order-5 w-24 md:order-none md:w-auto" data-grid-cell={cellKey("quantity")}>
        <div className="mb-0.5 text-[11px] text-muted-foreground md:hidden">Mengde</div>
        <LineNumberCell
          value={line.quantity}
          onChange={setGrams}
          disabled={!canWrite}
          title={percentPrimary ? "Avledet fra prosent" : (conversionWarning ?? undefined)}
          autoFocus={cellFocused("quantity")}
          onKeyDown={onKeyDown({ lineId: line.id, column: "quantity" })}
          aria-label="Mengde"
          placeholder="Gram"
          className="min-h-10"
        />
      </div>
      {conversionWarning && (
        <p className="order-11 basis-full text-xs text-warning md:col-span-9 md:order-none">{conversionWarning}</p>
      )}

      <div className="order-6 w-[72px] md:order-none md:w-auto" data-grid-cell={cellKey("unit")}>
        <div className="mb-0.5 text-[11px] text-muted-foreground md:hidden">Enhet</div>
        <select
          value={line.unit}
          onChange={(e) => onChange({ unit: e.target.value })}
          onKeyDown={onKeyDown({ lineId: line.id, column: "unit" })}
          disabled={!canWrite}
          className="h-10 w-full rounded-md border border-input bg-background px-1 text-sm md:h-9"
        >
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      <div className="order-7 w-24 md:order-none md:w-auto" data-grid-cell={cellKey("percent")}>
        <div className="mb-0.5 text-[11px] text-muted-foreground md:hidden">%</div>
        <LineNumberCell
          value={convertible ? showPct : ""}
          onChange={setPercent}
          disabled={!canWrite || flour || totalFlourG <= 0 || !convertible}
          suffix="%"
          title={
            !convertible
              ? `Ukjent omregning til gram for «${line.unit}» — bakerprosent kan ikke beregnes`
              : flour
                ? "Melprosent er avledet — mel definerer nevneren"
                : "Bakerprosent av samlet melvekt"
          }
          autoFocus={cellFocused("percent")}
          onKeyDown={onKeyDown({ lineId: line.id, column: "percent" })}
          aria-label="Bakerprosent"
          placeholder={convertible ? "%" : "?"}
          className={cn((flour || !convertible) && "bg-muted/60 text-muted-foreground")}
        />
      </div>

      <div className="order-8 flex justify-center md:order-none">
        {renderRowExtras ? renderRowExtras(line) : null}
      </div>

      <div className="order-9 w-[76px] md:order-none md:w-auto" data-grid-cell={cellKey("waste")}>
        <div className="mb-0.5 text-[11px] text-muted-foreground md:hidden">Svinn</div>
        <LineNumberCell
          value={line.waste_percent ?? 0}
          onChange={(v) => onChange({ waste_percent: v })}
          disabled={!canWrite}
          autoFocus={cellFocused("waste")}
          onKeyDown={onKeyDown({ lineId: line.id, column: "waste" })}
          aria-label="Svinn"
          placeholder="Svinn"
        />
      </div>

      {warning && (
        <div className="order-10 flex justify-center md:order-none" title={warning}>
          <AlertTriangle className="h-4 w-4 text-warning" />
        </div>
      )}

      {canWrite ? (
        <Button
          type="button" variant="ghost" size="icon" onClick={onRemove}
          aria-label="Slett ingrediens"
          className="order-3 ml-auto h-10 w-10 md:order-none md:ml-0 md:h-8 md:w-8 md:justify-self-end"
        >
          <Trash2 className="h-4 w-4 text-muted-foreground md:h-3.5 md:w-3.5" />
        </Button>
      ) : (
        <div className="order-3 md:order-none" />
      )}
    </div>
  );
}, areEqual);
