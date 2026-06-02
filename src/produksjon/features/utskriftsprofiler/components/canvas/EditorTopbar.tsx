import { ArrowLeft, RectangleVertical, RectangleHorizontal, Settings2, Undo2, Redo2, Eye, MousePointer2, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  subtitle?: string;
  paperWidth: number;
  paperHeight: number;
  landscape: boolean;
  mode: "design" | "preview";
  saved?: string | null;
  canUndo?: boolean;
  canRedo?: boolean;
  isSubmitting: boolean;
  isCreate: boolean;
  onChangePaperWidth: (v: number) => void;
  onChangePaperHeight: (v: number) => void;
  onToggleLandscape: (v: boolean) => void;
  onChangeMode: (m: "design" | "preview") => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenSettings: () => void;
  onCancel: () => void;
}

export function EditorTopbar(p: Props) {
  return (
    <div className="flex items-center gap-3 border-b border-white/10 bg-brand-ink px-4 py-2 text-brand-cream">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={p.onCancel}
        className="h-9 w-9 text-brand-cream/80 hover:bg-white/10 hover:text-brand-cream"
        aria-label="Tilbake"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold leading-tight tracking-tight">
          {p.name || "Uten navn"}
        </div>
        {p.subtitle && (
          <div className="truncate text-[11px] text-brand-cream/60">{p.subtitle}</div>
        )}
      </div>

      {/* Paper size */}
      <div className="flex items-center gap-2 rounded-[10px] border border-white/10 bg-white/5 px-2 py-1">
        <DimInput label="B" value={p.paperWidth} onChange={p.onChangePaperWidth} />
        <DimInput label="H" value={p.paperHeight} onChange={p.onChangePaperHeight} />
      </div>

      {/* Orientation */}
      <div className="flex items-center rounded-[10px] border border-white/10 bg-white/5 p-0.5">
        <button
          type="button"
          onClick={() => p.onToggleLandscape(false)}
          className={cn(
            "flex h-7 w-8 items-center justify-center rounded-md transition",
            !p.landscape ? "bg-white/15 text-brand-cream" : "text-brand-cream/60 hover:text-brand-cream",
          )}
          aria-label="Stående"
          title="Stående"
        >
          <RectangleVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => p.onToggleLandscape(true)}
          className={cn(
            "flex h-7 w-8 items-center justify-center rounded-md transition",
            p.landscape ? "bg-white/15 text-brand-cream" : "text-brand-cream/60 hover:text-brand-cream",
          )}
          aria-label="Liggende"
          title="Liggende"
        >
          <RectangleHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Design / Preview */}
      <div className="flex items-center rounded-[10px] border border-white/10 bg-white/5 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => p.onChangeMode("design")}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2.5 transition",
            p.mode === "design"
              ? "bg-white/15 text-brand-cream"
              : "text-brand-cream/60 hover:text-brand-cream",
          )}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
          Design
        </button>
        <button
          type="button"
          onClick={() => p.onChangeMode("preview")}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2.5 transition",
            p.mode === "preview"
              ? "bg-white/15 text-brand-cream"
              : "text-brand-cream/60 hover:text-brand-cream",
          )}
        >
          <Eye className="h-3.5 w-3.5" />
          Forhåndsvis
        </button>
      </div>

      {/* Saved status */}
      {p.saved && (
        <div className="flex items-center gap-1.5 text-[11px] text-brand-cream/60">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {p.saved}
        </div>
      )}

      {/* Undo/Redo */}
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-brand-cream/70 hover:bg-white/10 hover:text-brand-cream disabled:opacity-30"
          disabled={!p.canUndo}
          onClick={p.onUndo}
          aria-label="Angre"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-brand-cream/70 hover:bg-white/10 hover:text-brand-cream disabled:opacity-30"
          disabled={!p.canRedo}
          onClick={p.onRedo}
          aria-label="Gjenta"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-brand-cream/70 hover:bg-white/10 hover:text-brand-cream"
        onClick={p.onOpenSettings}
        aria-label="Innstillinger"
        title="Profil-innstillinger"
      >
        <Settings2 className="h-4 w-4" />
      </Button>

      <div className="mx-1 h-6 w-px bg-white/10" />

      <Button
        type="button"
        variant="ghost"
        onClick={p.onCancel}
        disabled={p.isSubmitting}
        className="h-8 text-brand-cream/80 hover:bg-white/10 hover:text-brand-cream"
      >
        Avbryt
      </Button>
      <Button type="submit" variant="brand" disabled={p.isSubmitting} className="h-8">
        {p.isSubmitting ? "Lagrer …" : p.isCreate ? "Opprett" : "Lagre endringer"}
      </Button>
    </div>
  );
}

function DimInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px]">
      <span className="font-semibold uppercase tracking-wide text-brand-cream">{label}</span>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(10, Number(e.target.value) || 0))}
        className="h-7 w-16 border-white/20 bg-white/10 px-2 text-center text-xs font-semibold tabular-nums text-brand-cream placeholder:text-brand-cream/40 focus-visible:ring-brand-bronze"
      />
      <span className="text-brand-cream/60">mm</span>
    </label>
  );
}
