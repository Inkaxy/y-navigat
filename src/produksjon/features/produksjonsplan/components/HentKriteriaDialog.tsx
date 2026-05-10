import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2 } from "lucide-react";
import {
  useCriteriaTemplates,
  useDeleteCriteriaTemplate,
} from "../hooks/useCriteriaTemplates";
import { useTemplateCategories } from "../hooks/useTemplateCategories";
import type { CriteriaTemplate } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legalEntityId: string | null;
  onPick: (t: CriteriaTemplate) => void;
  onEdit?: (t: CriteriaTemplate) => void;
}

export function HentKriteriaDialog({ open, onOpenChange, legalEntityId, onPick, onEdit }: Props) {
  const [q, setQ] = useState("");
  const templates = useCriteriaTemplates(legalEntityId);
  const cats = useTemplateCategories();
  const del = useDeleteCriteriaTemplate(legalEntityId);

  const filtered = (templates.data ?? []).filter((t) =>
    t.name.toLowerCase().includes(q.toLowerCase()),
  );

  const colorFor = (code: string | null) => {
    if (!code) return "#f1f5f9";
    return cats.data?.find((c) => c.code === code)?.color_hex ?? "#f1f5f9";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Hent kriteria</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Filtrere..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-80 overflow-auto rounded-md border border-border">
          {filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Ingen lagrede maler.
            </div>
          )}
          {filtered.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 border-b border-border last:border-0"
            >
              <button
                type="button"
                onClick={() => { onPick(t); onOpenChange(false); }}
                className="flex-1 text-left px-3 py-2 text-sm hover:opacity-80 transition-opacity"
                style={{ backgroundColor: colorFor(t.category_code) }}
              >
                {t.name}
              </button>
              {onEdit && (
                <Button variant="ghost" size="icon" onClick={() => { onEdit(t); onOpenChange(false); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (confirm(`Slette mal "${t.name}"?`)) del.mutate(t.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Lukk</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
