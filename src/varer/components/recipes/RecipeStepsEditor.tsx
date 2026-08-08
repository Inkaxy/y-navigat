import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, ListOrdered } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BREAD_DEFAULT_STEPS, STEP_TYPE_OPTIONS } from "@/varer/lib/bakers";

export type EditorStep = {
  id: string;
  _new?: boolean;
  sort_order: number;
  step_type: string;
  title: string | null;
  instruction: string | null;
  duration_minutes: number | null;
  temp_celsius: number | null;
  humidity_pct: number | null;
};

interface Props {
  steps: EditorStep[];
  canWrite: boolean;
  onChange: (steps: EditorStep[]) => void;
}

function newStep(sort_order: number, step_type = "other", title: string | null = null): EditorStep {
  return {
    id: `new-step-${Date.now()}-${Math.random()}`,
    _new: true,
    sort_order,
    step_type,
    title,
    instruction: null,
    duration_minutes: null,
    temp_celsius: null,
    humidity_pct: null,
  };
}

export function RecipeStepsEditor({ steps, canWrite, onChange }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = steps.findIndex((s) => s.id === active.id);
    const newIdx = steps.findIndex((s) => s.id === over.id);
    onChange(arrayMove(steps, oldIdx, newIdx).map((s, i) => ({ ...s, sort_order: i })));
  }

  const totalMinutes = steps.reduce((s, x) => s + (Number(x.duration_minutes) || 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListOrdered className="h-4 w-4 text-app" /> Prosess
          <span className="text-xs font-normal text-muted-foreground">
            {steps.length} steg · {Math.floor(totalMinutes / 60)} t {totalMinutes % 60} min
          </span>
        </CardTitle>
        {canWrite && steps.length === 0 && (
          <Button
            type="button" variant="outline" size="sm"
            onClick={() => onChange(BREAD_DEFAULT_STEPS.map((s, i) => newStep(i, s.step_type, s.title)))}
          >
            Sett inn standard brødkjede
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {steps.map((s, i) => (
              <SortableStep
                key={s.id}
                step={s}
                index={i}
                canWrite={canWrite}
                onChange={(patch) => onChange(steps.map((x) => (x.id === s.id ? { ...x, ...patch } : x)))}
                onRemove={() => onChange(steps.filter((x) => x.id !== s.id).map((x, idx) => ({ ...x, sort_order: idx })))}
              />
            ))}
          </SortableContext>
        </DndContext>
        {steps.length === 0 && (
          <div className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
            Ingen prosess-steg ennå.
          </div>
        )}
        {canWrite && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...steps, newStep(steps.length)])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Legg til steg
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SortableStep({
  step, index, canWrite, onChange, onRemove,
}: {
  step: EditorStep;
  index: number;
  canWrite: boolean;
  onChange: (p: Partial<EditorStep>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="rounded-md border border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing">
            <GripVertical className="h-4 w-4" />
          </button>
        ) : <span className="w-4" />}
        <span className="w-5 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
        <select
          value={step.step_type}
          onChange={(e) => onChange({ step_type: e.target.value })}
          disabled={!canWrite}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          {STEP_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Input
          className="h-8 w-52" placeholder="Tittel" value={step.title ?? ""} disabled={!canWrite}
          onChange={(e) => onChange({ title: e.target.value || null })}
        />
        <Input
          type="number" className="h-8 w-24 tabular-nums" placeholder="Min" value={step.duration_minutes ?? ""} disabled={!canWrite}
          onChange={(e) => onChange({ duration_minutes: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <Input
          type="number" step="0.5" className="h-8 w-24 tabular-nums" placeholder="°C" value={step.temp_celsius ?? ""} disabled={!canWrite}
          onChange={(e) => onChange({ temp_celsius: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <Input
          type="number" className="h-8 w-24 tabular-nums" placeholder="% RF" value={step.humidity_pct ?? ""} disabled={!canWrite}
          onChange={(e) => onChange({ humidity_pct: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <div className="flex-1" />
        {canWrite && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>
      <Textarea
        rows={1} className="mt-2" placeholder="Instruksjon…" value={step.instruction ?? ""} disabled={!canWrite}
        onChange={(e) => onChange({ instruction: e.target.value || null })}
      />
    </div>
  );
}
