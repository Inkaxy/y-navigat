
import { Trash2, MoreVertical, Copy, ArrowUp, ArrowDown, FileText, Wheat, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { LineGrid } from "@/varer/components/recipes/LineGrid";
import { useStockTrackedRawMaterials } from "@/varer/hooks/useStockTrackedRawMaterials";
import {
  PART_TYPE_OPTIONS, PREFERMENT_KIND_OPTIONS, computePartSummary,
  fmtG, fmtPercent, isFlourLine,
  type BakersLine, type BakersRawMaterial,
} from "@/varer/lib/bakers";
import { PART_ENTRY_MODE_LABEL, type PartEntryMode } from "@/varer/lib/percentFirst";

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
  /** Legger til en linje og returnerer id-en, slik at griddet kan fokusere den. */
  onAddLine: () => string | null;
  onUpdateLine: (id: string, patch: Partial<EditorLine>) => void;
  onRemoveLine: (id: string) => void;
  onReorderLines: (partId: string, activeId: string, overId: string) => void;
  /** Registreringsmodus for delen — «gram» eller «prosent». */
  entryMode?: PartEntryMode;
  onEntryModeChange?: (mode: PartEntryMode) => void;
  /** Advarselstekst per linje-id. */
  warningsByLine?: Record<string, string | undefined>;
  /** Oppskriften som redigeres — brukes til sirkelvern i ingrediensvelgeren. */
  currentRecipeId?: string | null;
}

export function RecipePartCard({
  part, lines, canWrite, totalFlourG, rmMap, isFirst, isLast,
  onUpdate, onRemove, onDuplicate, onMove, onAddLine, onUpdateLine, onRemoveLine, onReorderLines,
  entryMode = "grams", onEntryModeChange, warningsByLine, currentRecipeId = null,
}: Props) {
  const isPreferment = part.part_type === "preferment";
  const summary = computePartSummary(lines, totalFlourG);

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
        {canWrite && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Registrering</Label>
            <div className="inline-flex overflow-hidden rounded-md border border-input">
              {(["grams", "percent"] as PartEntryMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onEntryModeChange?.(mode)}
                  className={cn(
                    "px-2.5 py-1 text-xs",
                    entryMode === mode ? "bg-app/10 font-medium text-app" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {PART_ENTRY_MODE_LABEL[mode]}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {entryMode === "percent"
                ? "Du skriver bakerprosent — gram regnes ut fra melvekten."
                : "Du skriver gram — bakerprosent regnes ut."}
            </span>
          </div>
        )}

        <LineGrid
          partId={part.id}
          lines={lines}
          canWrite={canWrite}
          totalFlourG={totalFlourG}
          rmMap={rmMap}
          entryMode={entryMode}
          currentRecipeId={currentRecipeId}
          warningsByLine={warningsByLine}
          onUpdateLine={onUpdateLine}
          onRemoveLine={onRemoveLine}
          onReorderLines={onReorderLines}
          onAddLine={onAddLine}
          renderRowExtras={(line) => (
            <LineExtras line={line} canWrite={canWrite} onChange={(patch) => onUpdateLine(line.id, patch)} />
          )}
        />

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

/** Melbryter, deklarasjon og lagermerke — ekstrafeltene ytterst på en linje. */
function LineExtras({
  line, canWrite, onChange,
}: { line: EditorLine; canWrite: boolean; onChange: (p: Partial<EditorLine>) => void }) {
  const { data: trackedIds } = useStockTrackedRawMaterials();
  const stockTracked = !!line.raw_material_id && !!trackedIds?.has(line.raw_material_id);
  return (
    <div className="flex items-center">
      <FlourToggle line={line} flour={isFlourLine(line)} canWrite={canWrite} onChange={onChange} />
      <DeclarationPopover line={line} canWrite={canWrite} onChange={onChange} />
      {stockTracked && (
        <Package
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-label="Lagerføres"
        />
      )}
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
