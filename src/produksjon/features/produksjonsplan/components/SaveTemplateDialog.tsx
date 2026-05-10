import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTemplateCategories } from "../hooks/useTemplateCategories";
import { useSaveCriteriaTemplate } from "../hooks/useCriteriaTemplates";
import type { CriteriaTemplate, ProduksjonsplanCriteria } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legalEntityId: string | null;
  criteria: ProduksjonsplanCriteria;
  editing?: CriteriaTemplate | null;
  onSaved?: (template: { id?: string; name: string; category_code: string | null }) => void;
}

export function SaveTemplateDialog({ open, onOpenChange, legalEntityId, criteria, editing, onSaved }: Props) {
  const cats = useTemplateCategories();
  const save = useSaveCriteriaTemplate(legalEntityId);

  const [name, setName] = useState("");
  const [categoryCode, setCategoryCode] = useState<string>("");

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setCategoryCode(editing?.category_code ?? "");
    }
  }, [open, editing]);

  const submit = async () => {
    if (!name.trim()) return;
    const inferred = categoryCode || name.trim().charAt(0).toUpperCase();
    await save.mutateAsync({
      id: editing?.id,
      name: name.trim(),
      category_code: inferred || null,
      criteria,
    });
    onSaved?.({ id: editing?.id, name: name.trim(), category_code: inferred || null });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Rediger mal" : "Lagre som mal"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Navn</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="F.eks. B - Kl: 14:00 WB+Bakeri liste" />
          </div>
          <div>
            <Label className="text-sm">Kategori</Label>
            <Select value={categoryCode || undefined} onValueChange={setCategoryCode}>
              <SelectTrigger>
                <SelectValue placeholder="Auto (første bokstav i navn)" />
              </SelectTrigger>
              <SelectContent>
                {(cats.data ?? []).map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-sm border border-border"
                        style={{ backgroundColor: c.color_hex }}
                      />
                      <span className="font-mono text-xs">{c.code}</span>
                      {c.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={submit} disabled={!name.trim() || save.isPending}>Lagre</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
