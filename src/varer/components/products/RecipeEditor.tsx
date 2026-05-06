import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Trash2, Loader2, Save, GripVertical, ChevronDown, MoreVertical,
  AlertTriangle, Copy, ArrowUp, ArrowDown, Pencil, Check, X, FileText,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { logAudit } from "@/varer/lib/audit";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RawMaterialAutocomplete, RawMaterialOption } from "./RawMaterialAutocomplete";
import { RecipeProductLinks } from "./RecipeProductLinks";

interface Props {
  productId: string;
  productName: string;
  canWrite: boolean;
}

type Line = {
  id: string;
  _new?: boolean;
  recipe_part_id: string;
  raw_material_id: string | null;
  ingredient_name: string | null;
  quantity: number | string;
  unit: string;
  waste_percent: number | string;
  sort_order: number;
  notes?: string | null;
  include_in_declaration?: boolean;
  is_quid_relevant?: boolean;
  custom_declaration_text?: string | null;
  _rm?: RawMaterialOption | null;
};

type Part = {
  id: string;
  _new?: boolean;
  name: string;
  sort_order: number;
  instructions: string | null;
  prep_time_minutes: number | null;
  rest_time_minutes: number | null;
};

const UNITS = ["g", "kg", "ml", "liter", "stk"];

export function RecipeEditor({ productId, productName, canWrite }: Props) {
  const qc = useQueryClient();

  const recipeQuery = useQuery({
    queryKey: ["recipe", productId],
    queryFn: async () => {
      const { data } = await supabase
        .from("recipes")
        .select("*, recipe_parts(*), recipe_lines(*, raw_materials(id, sku, name, category, base_unit, current_cost_price))")
        .eq("product_id", productId)
        .is("valid_to", null)
        .maybeSingle();
      return data;
    },
  });

  const recipe = recipeQuery.data;
  const [creating, setCreating] = useState(false);

  async function createRecipe() {
    setCreating(true);
    const { data, error } = await supabase
      .from("recipes")
      .insert({ product_id: productId, yield_quantity: 1, yield_unit: "stk" } as never)
      .select()
      .single();
    if (error) {
      setCreating(false);
      toast.error(error.message);
      return;
    }
    // Opprett standard "Hoveddel"
    await supabase.from("recipe_parts").insert({
      recipe_id: data.id,
      name: "Hoveddel",
      sort_order: 0,
    } as never);
    setCreating(false);
    await logAudit({ action: "create", entity_type: "recipe", entity_id: data.id, entity_display_reference: productName });
    qc.invalidateQueries({ queryKey: ["recipe", productId] });
    toast.success("Oppskrift opprettet");
  }

  if (recipeQuery.isLoading) {
    return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (!recipe) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">Ingen aktiv oppskrift for denne varen ennå.</p>
          {canWrite && (
            <Button onClick={createRecipe} disabled={creating} className="bg-app hover:bg-app-dark text-app-foreground">
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Opprett oppskrift
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return <RecipeForm recipe={recipe} productName={productName} canWrite={canWrite} />;
}

function RecipeForm({ recipe, productName, canWrite }: { recipe: any; productName: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [yieldQty, setYieldQty] = useState(String(recipe.yield_quantity));
  const [yieldUnit, setYieldUnit] = useState(recipe.yield_unit);
  const [yieldGrams, setYieldGrams] = useState(recipe.yield_grams != null ? String(recipe.yield_grams) : "");
  const [yieldLossPct, setYieldLossPct] = useState(String(recipe.yield_loss_pct ?? 0));
  const [notes, setNotes] = useState(recipe.notes ?? "");
  const [productionNotes, setProductionNotes] = useState(recipe.production_notes ?? "");
  const [bulkProof, setBulkProof] = useState(recipe.bulk_proof_minutes ?? "");
  const [shapeProof, setShapeProof] = useState(recipe.shape_proof_minutes ?? "");
  const [bakeTemp, setBakeTemp] = useState(recipe.bake_temp_celsius ?? "");
  const [bakeTime, setBakeTime] = useState(recipe.bake_time_minutes ?? "");
  const [steam, setSteam] = useState(recipe.steam_seconds ?? "");
  const [cooling, setCooling] = useState(recipe.cooling_minutes ?? "");

  const initialParts: Part[] = useMemo(() =>
    ((recipe.recipe_parts ?? []) as Part[])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order),
    [recipe.recipe_parts],
  );
  const [parts, setParts] = useState<Part[]>(initialParts);

  const initialLines: Line[] = useMemo(() =>
    ((recipe.recipe_lines ?? []) as any[])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({
        ...l,
        _rm: l.raw_materials ?? null,
      })),
    [recipe.recipe_lines],
  );
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [saving, setSaving] = useState(false);

  // Hvis det ikke finnes parts (gammelt skjema), opprett en lokal "Hoveddel"-stub som lagres ved Lagre.
  useEffect(() => {
    if (parts.length === 0) {
      const tmpId = `new-part-${Date.now()}`;
      setParts([{ id: tmpId, _new: true, name: "Hoveddel", sort_order: 0, instructions: null, prep_time_minutes: null, rest_time_minutes: null }]);
      setLines((ls) => ls.map((l) => l.recipe_part_id ? l : { ...l, recipe_part_id: tmpId }));
    }
  }, []); // eslint-disable-line

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const totalActive = (Number(bulkProof) || 0) + (Number(bakeTime) || 0);
  const totalRest = (Number(shapeProof) || 0) + (Number(cooling) || 0);

  function addPart() {
    const tmpId = `new-part-${Date.now()}`;
    setParts([...parts, { id: tmpId, _new: true, name: `Del ${parts.length + 1}`, sort_order: parts.length, instructions: null, prep_time_minutes: null, rest_time_minutes: null }]);
  }
  function updatePart(id: string, patch: Partial<Part>) {
    setParts(parts.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function removePart(id: string) {
    const linesInPart = lines.filter((l) => l.recipe_part_id === id);
    if (linesInPart.length > 0 && !confirm(`Denne delen har ${linesInPart.length} linjer. Slette delen og alle linjene?`)) return;
    setParts(parts.filter((p) => p.id !== id).map((p, i) => ({ ...p, sort_order: i })));
    setLines(lines.filter((l) => l.recipe_part_id !== id));
  }
  function duplicatePart(id: string) {
    const p = parts.find((x) => x.id === id);
    if (!p) return;
    const newId = `new-part-${Date.now()}`;
    const idx = parts.findIndex((x) => x.id === id);
    const newPart: Part = { ...p, id: newId, _new: true, name: `${p.name} (kopi)`, sort_order: idx + 1 };
    const dupLines = lines.filter((l) => l.recipe_part_id === id).map((l) => ({
      ...l,
      id: `new-line-${Date.now()}-${Math.random()}`,
      _new: true,
      recipe_part_id: newId,
    }));
    const newParts = [...parts.slice(0, idx + 1), newPart, ...parts.slice(idx + 1)].map((p, i) => ({ ...p, sort_order: i }));
    setParts(newParts);
    setLines([...lines, ...dupLines]);
  }
  function movePart(id: string, dir: -1 | 1) {
    const idx = parts.findIndex((p) => p.id === id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= parts.length) return;
    const moved = arrayMove(parts, idx, newIdx).map((p, i) => ({ ...p, sort_order: i }));
    setParts(moved);
  }

  function addLine(partId: string) {
    const partLines = lines.filter((l) => l.recipe_part_id === partId);
    const newLine: Line = {
      id: `new-line-${Date.now()}-${Math.random()}`,
      _new: true,
      recipe_part_id: partId,
      raw_material_id: null,
      ingredient_name: null,
      quantity: "",
      unit: "g",
      waste_percent: 0,
      sort_order: partLines.length,
      include_in_declaration: true,
      is_quid_relevant: false,
      custom_declaration_text: null,
    };
    setLines([...lines, newLine]);
  }
  function updateLine(id: string, patch: Partial<Line>) {
    setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeLine(id: string) {
    setLines(lines.filter((l) => l.id !== id));
  }

  function handlePartDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = parts.findIndex((p) => p.id === active.id);
    const newIdx = parts.findIndex((p) => p.id === over.id);
    setParts(arrayMove(parts, oldIdx, newIdx).map((p, i) => ({ ...p, sort_order: i })));
  }

  function handleLineDragEnd(partId: string) {
    return (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const partLines = lines.filter((l) => l.recipe_part_id === partId);
      const others = lines.filter((l) => l.recipe_part_id !== partId);
      const oldIdx = partLines.findIndex((l) => l.id === active.id);
      const newIdx = partLines.findIndex((l) => l.id === over.id);
      const reordered = arrayMove(partLines, oldIdx, newIdx).map((l, i) => ({ ...l, sort_order: i }));
      setLines([...others, ...reordered]);
    };
  }

  async function save() {
    setSaving(true);
    try {
      // 1) Oppdater recipe-felter
      const { error: e1 } = await supabase
        .from("recipes")
        .update({
          yield_quantity: Number(yieldQty) || 1,
          yield_unit: yieldUnit,
          yield_grams: yieldGrams === "" ? null : Number(yieldGrams),
          yield_loss_pct: Number(yieldLossPct) || 0,
          notes: notes || null,
          production_notes: productionNotes || null,
          bulk_proof_minutes: bulkProof === "" ? null : Number(bulkProof),
          shape_proof_minutes: shapeProof === "" ? null : Number(shapeProof),
          bake_temp_celsius: bakeTemp === "" ? null : Number(bakeTemp),
          bake_time_minutes: bakeTime === "" ? null : Number(bakeTime),
          steam_seconds: steam === "" ? null : Number(steam),
          cooling_minutes: cooling === "" ? null : Number(cooling),
        })
        .eq("id", recipe.id);
      if (e1) throw e1;

      // 2) Slett fjernede parts
      const existingPartIds = parts.filter((p) => !p._new).map((p) => p.id);
      const originalPartIds = (recipe.recipe_parts ?? []).map((p: any) => p.id);
      const partsToDelete = originalPartIds.filter((id: string) => !existingPartIds.includes(id));
      if (partsToDelete.length) {
        await supabase.from("recipe_parts").delete().in("id", partsToDelete);
      }

      // 3) Upsert parts og bygg id-map for nye parts
      const partIdMap: Record<string, string> = {};
      for (const p of parts) {
        if (p._new) {
          const { data, error } = await supabase
            .from("recipe_parts")
            .insert({
              recipe_id: recipe.id,
              name: p.name,
              sort_order: p.sort_order,
              instructions: p.instructions,
              prep_time_minutes: p.prep_time_minutes,
              rest_time_minutes: p.rest_time_minutes,
            } as never)
            .select("id")
            .single();
          if (error) throw error;
          partIdMap[p.id] = data.id;
        } else {
          await supabase
            .from("recipe_parts")
            .update({
              name: p.name,
              sort_order: p.sort_order,
              instructions: p.instructions,
              prep_time_minutes: p.prep_time_minutes,
              rest_time_minutes: p.rest_time_minutes,
            })
            .eq("id", p.id);
        }
      }

      // 4) Slett fjernede linjer
      const existingLineIds = lines.filter((l) => !l._new).map((l) => l.id);
      const originalLineIds = (recipe.recipe_lines ?? []).map((l: any) => l.id);
      const linesToDelete = originalLineIds.filter((id: string) => !existingLineIds.includes(id));
      if (linesToDelete.length) {
        await supabase.from("recipe_lines").delete().in("id", linesToDelete);
      }

      // 5) Upsert linjer
      for (const l of lines) {
        const partId = partIdMap[l.recipe_part_id] ?? l.recipe_part_id;
        const qty = Number(l.quantity) || 0;
        if (qty <= 0 && !l.raw_material_id && !l.ingredient_name) continue;
        const payload = {
          recipe_id: recipe.id,
          recipe_part_id: partId,
          raw_material_id: l.raw_material_id,
          ingredient_name: l.raw_material_id ? null : (l.ingredient_name || null),
          quantity: qty,
          unit: l.unit,
          waste_percent: Number(l.waste_percent) || 0,
          sort_order: l.sort_order,
          notes: l.notes ?? null,
          include_in_declaration: l.include_in_declaration !== false,
          is_quid_relevant: !!l.is_quid_relevant,
          custom_declaration_text: l.custom_declaration_text || null,
        };
        if (l._new) {
          await supabase.from("recipe_lines").insert(payload as never);
        } else {
          await supabase.from("recipe_lines").update(payload).eq("id", l.id);
        }
      }

      await logAudit({
        action: "update",
        entity_type: "recipe",
        entity_id: recipe.id,
        entity_display_reference: productName,
        changes: { parts: parts.length, lines: lines.length },
      });
      toast.success("Oppskrift lagret");
      qc.invalidateQueries({ queryKey: ["recipe", recipe.product_id] });
      qc.invalidateQueries({ queryKey: ["recipes-cleanup"] });
    } catch (err: any) {
      toast.error(err.message ?? "Kunne ikke lagre");
    } finally {
      setSaving(false);
    }
  }

  const showPartHeaders = parts.length > 1;
  const unmatchedCount = lines.filter((l) => !l.raw_material_id).length;

  return (
    <div className="space-y-4">
      <RecipeProductLinks recipeId={recipe.id} currentProductId={recipe.product_id} canWrite={canWrite} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Aktiv oppskrift <span className="text-muted-foreground font-normal">v{recipe.version}</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {recipe.requires_cleanup && (
              <Badge variant="outline" className="text-warning border-warning/40 bg-warning/10">
                <AlertTriangle className="mr-1 h-3 w-3" /> Krever opprydding
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              Aktiv tid: {totalActive} min · Hvile/heving: {totalRest} min
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 max-w-2xl">
            <div>
              <Label>Utbytte</Label>
              <Input type="number" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <Label>Enhet</Label>
              <Input value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <Label>Vekt/enhet (g)</Label>
              <Input type="number" value={yieldGrams} onChange={(e) => setYieldGrams(e.target.value)} disabled={!canWrite} placeholder="valgfri" />
            </div>
            <div>
              <Label>Svinn %</Label>
              <Input type="number" step="0.1" value={yieldLossPct} onChange={(e) => setYieldLossPct(e.target.value)} disabled={!canWrite} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Ingredienser</CardTitle>
            {unmatchedCount > 0 && (
              <p className="text-xs text-warning mt-0.5">{unmatchedCount} linje{unmatchedCount === 1 ? "" : "r"} mangler råvare-kobling</p>
            )}
          </div>
          {canWrite && (
            <Button type="button" variant="outline" size="sm" onClick={addPart}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Legg til del
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePartDragEnd}>
            <SortableContext items={parts.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {parts.map((part, idx) => (
                  <SortablePart
                    key={part.id}
                    part={part}
                    showHeader={showPartHeaders}
                    isFirst={idx === 0}
                    isLast={idx === parts.length - 1}
                    canWrite={canWrite}
                    lines={lines.filter((l) => l.recipe_part_id === part.id)}
                    onUpdate={(patch) => updatePart(part.id, patch)}
                    onRemove={() => removePart(part.id)}
                    onDuplicate={() => duplicatePart(part.id)}
                    onMoveUp={() => movePart(part.id, -1)}
                    onMoveDown={() => movePart(part.id, 1)}
                    onAddLine={() => addLine(part.id)}
                    onUpdateLine={updateLine}
                    onRemoveLine={removeLine}
                    onLineDragEnd={handleLineDragEnd(part.id)}
                    sensors={sensors}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produksjonsparametre</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-w-3xl">
            <div>
              <Label>Bulk-heving (min)</Label>
              <Input type="number" value={bulkProof} onChange={(e) => setBulkProof(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <Label>Forming/heving (min)</Label>
              <Input type="number" value={shapeProof} onChange={(e) => setShapeProof(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <Label>Steketemp (°C)</Label>
              <Input type="number" value={bakeTemp} onChange={(e) => setBakeTemp(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <Label>Steketid (min)</Label>
              <Input type="number" value={bakeTime} onChange={(e) => setBakeTime(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <Label>Damp (sek)</Label>
              <Input type="number" value={steam} onChange={(e) => setSteam(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <Label>Avkjøling (min)</Label>
              <Input type="number" value={cooling} onChange={(e) => setCooling(e.target.value)} disabled={!canWrite} />
            </div>
          </div>
          <div>
            <Label>Produksjonsnotater</Label>
            <Textarea rows={2} value={productionNotes} onChange={(e) => setProductionNotes(e.target.value)} disabled={!canWrite} />
          </div>
          <div>
            <Label>Notater</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canWrite} />
          </div>
        </CardContent>
      </Card>

      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} className="bg-app hover:bg-app-dark text-app-foreground">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Lagre oppskrift
          </Button>
        </div>
      )}
    </div>
  );
}

function SortablePart({
  part, showHeader, isFirst, isLast, canWrite, lines,
  onUpdate, onRemove, onDuplicate, onMoveUp, onMoveDown,
  onAddLine, onUpdateLine, onRemoveLine, onLineDragEnd, sensors,
}: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: part.id });
  const [open, setOpen] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(part.name);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-border bg-background">
      {showHeader && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="flex items-center gap-2 border-b border-border px-2 py-2">
            {canWrite && (
              <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing">
                <GripVertical className="h-4 w-4" />
              </button>
            )}
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1 text-sm font-medium">
                <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
              </button>
            </CollapsibleTrigger>
            {editingName ? (
              <div className="flex flex-1 items-center gap-1">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="h-7"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { onUpdate({ name: nameDraft }); setEditingName(false); }
                    if (e.key === "Escape") { setNameDraft(part.name); setEditingName(false); }
                  }}
                />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { onUpdate({ name: nameDraft }); setEditingName(false); }}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setNameDraft(part.name); setEditingName(false); }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <button
                className={cn("flex-1 text-left text-sm font-medium", canWrite && "hover:underline")}
                onClick={() => canWrite && setEditingName(true)}
              >
                {part.name}
              </button>
            )}
            <span className="text-xs text-muted-foreground">{lines.length} linjer</span>
            {canWrite && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditingName(true)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" /> Rediger navn
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onMoveUp} disabled={isFirst}>
                    <ArrowUp className="mr-2 h-3.5 w-3.5" /> Flytt opp
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onMoveDown} disabled={isLast}>
                    <ArrowDown className="mr-2 h-3.5 w-3.5" /> Flytt ned
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onDuplicate}>
                    <Copy className="mr-2 h-3.5 w-3.5" /> Dupliser
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Slett del
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <CollapsibleContent>
            <PartBody part={part} lines={lines} canWrite={canWrite} onUpdate={onUpdate}
              onAddLine={onAddLine} onUpdateLine={onUpdateLine} onRemoveLine={onRemoveLine}
              onLineDragEnd={onLineDragEnd} sensors={sensors} />
          </CollapsibleContent>
        </Collapsible>
      )}
      {!showHeader && (
        <PartBody part={part} lines={lines} canWrite={canWrite} onUpdate={onUpdate}
          onAddLine={onAddLine} onUpdateLine={onUpdateLine} onRemoveLine={onRemoveLine}
          onLineDragEnd={onLineDragEnd} sensors={sensors} />
      )}
    </div>
  );
}

function PartBody({
  part, lines, canWrite, onUpdate, onAddLine, onUpdateLine, onRemoveLine, onLineDragEnd, sensors,
}: any) {
  return (
    <div className="space-y-3 p-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onLineDragEnd}>
        <SortableContext items={lines.map((l: Line) => l.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {lines.length === 0 && (
              <div className="rounded-md border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
                Ingen linjer. Klikk «Legg til ingrediens».
              </div>
            )}
            {lines.map((l: Line) => (
              <SortableLine
                key={l.id}
                line={l}
                canWrite={canWrite}
                onChange={(patch) => onUpdateLine(l.id, patch)}
                onRemove={() => onRemoveLine(l.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {canWrite && (
        <div className="flex justify-start">
          <Button type="button" variant="ghost" size="sm" onClick={onAddLine}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Legg til ingrediens
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
        <div>
          <Label className="text-xs">Prep-tid (min)</Label>
          <Input type="number" value={part.prep_time_minutes ?? ""} onChange={(e) => onUpdate({ prep_time_minutes: e.target.value === "" ? null : Number(e.target.value) })} disabled={!canWrite} />
        </div>
        <div>
          <Label className="text-xs">Hvile-tid (min)</Label>
          <Input type="number" value={part.rest_time_minutes ?? ""} onChange={(e) => onUpdate({ rest_time_minutes: e.target.value === "" ? null : Number(e.target.value) })} disabled={!canWrite} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Fremgangsmåte</Label>
        <Textarea rows={2} value={part.instructions ?? ""} onChange={(e) => onUpdate({ instructions: e.target.value })} disabled={!canWrite} />
      </div>
    </div>
  );
}

function SortableLine({ line, canWrite, onChange, onRemove }: { line: Line; canWrite: boolean; onChange: (p: Partial<Line>) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: line.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const unmatched = !line.raw_material_id;
  const include = line.include_in_declaration !== false;
  const isQuid = !!line.is_quid_relevant;
  const hasCustom = !!line.custom_declaration_text;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "grid grid-cols-12 items-center gap-2 rounded-md border px-2 py-1.5",
        unmatched ? "border-warning/40 bg-warning/5" : "border-transparent",
      )}
    >
      {canWrite ? (
        <button {...attributes} {...listeners} className="col-span-1 flex justify-center cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing">
          <GripVertical className="h-4 w-4" />
        </button>
      ) : <div className="col-span-1" />}

      <div className="col-span-4">
        <RawMaterialAutocomplete
          value={line.raw_material_id}
          disabled={!canWrite}
          onChange={(id, opt) => {
            onChange({
              raw_material_id: id,
              ingredient_name: opt?.name ?? line.ingredient_name,
              unit: opt?.base_unit ?? line.unit,
            });
          }}
          placeholder={line.ingredient_name ? `(ukoblet) ${line.ingredient_name}` : "Velg råvare…"}
        />
      </div>
      <div className="col-span-2">
        <Input
          type="number" step="any" placeholder="Mengde"
          value={line.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          disabled={!canWrite} className="h-9"
        />
      </div>
      <div className="col-span-1">
        <select
          value={line.unit}
          onChange={(e) => onChange({ unit: e.target.value })}
          disabled={!canWrite}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div className="col-span-2">
        <Input
          type="number" step="0.1" placeholder="Svinn %"
          value={line.waste_percent ?? 0}
          onChange={(e) => onChange({ waste_percent: e.target.value })}
          disabled={!canWrite} className="h-9"
        />
      </div>
      <div className="col-span-1 flex justify-center">
        <DeclarationPopover
          line={line} canWrite={canWrite}
          include={include} isQuid={isQuid} hasCustom={hasCustom}
          onChange={onChange}
        />
      </div>
      {canWrite ? (
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} className="col-span-1 h-8 w-8">
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      ) : <div className="col-span-1" />}
    </div>
  );
}

function DeclarationPopover({
  line, canWrite, include, isQuid, hasCustom, onChange,
}: {
  line: Line; canWrite: boolean; include: boolean; isQuid: boolean; hasCustom: boolean;
  onChange: (p: Partial<Line>) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button" variant="ghost" size="icon"
          className={cn("h-8 w-8 relative", !include && "text-muted-foreground/60")}
          title="Deklarasjon"
        >
          <FileText className="h-4 w-4" />
          {(isQuid || hasCustom || !include) && (
            <span className={cn(
              "absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full",
              !include ? "bg-muted-foreground" : isQuid ? "bg-app" : "bg-warning",
            )} />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-3 space-y-3" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="text-xs font-medium text-muted-foreground">Deklarasjons­innstillinger</div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox" className="mt-0.5"
            checked={include} disabled={!canWrite}
            onChange={(e) => onChange({ include_in_declaration: e.target.checked })}
          />
          <span>
            <span className="font-medium">Inkluder i ingrediensliste</span>
            <span className="block text-xs text-muted-foreground">Skru av for f.eks. drysse-mel.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox" className="mt-0.5"
            checked={isQuid} disabled={!canWrite || !include}
            onChange={(e) => onChange({ is_quid_relevant: e.target.checked })}
          />
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
          <p className="mt-1 text-[11px] text-muted-foreground">Erstatter automatisk navn + allergen-fete.</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
