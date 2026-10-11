import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CreateDraft } from "./createSheetLogic";

interface Props {
  draft: CreateDraft;
  set: (patch: Partial<CreateDraft>) => void;
}

/** «Flere felt» i standalone-modus: flere kategorier, beskrivelse og startkostpris. */
export function CreateSheetMoreFields({ draft, set }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between">
          Flere felt
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3 rounded-lg border p-3">
        <div>
          <Label htmlFor="rcs-cats">Flere kategorier</Label>
          <Input
            id="rcs-cats"
            value={draft.extraCategories.join(", ")}
            onChange={(e) => set({ extraCategories: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) })}
            placeholder="Kommaseparert, f.eks. Mel, Økologisk"
          />
        </div>
        <div>
          <Label htmlFor="rcs-desc">Beskrivelse</Label>
          <Textarea id="rcs-desc" rows={2} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="rcs-cost">Startkostpris (kr/{draft.baseUnit})</Label>
          <Input id="rcs-cost" inputMode="decimal" value={draft.startCost} onChange={(e) => set({ startCost: e.target.value })} placeholder="Valgfritt" />
          <p className="mt-1 text-caption text-muted-foreground">Lagres i prishistorikken med begrunnelsen «Startkostpris ved opprettelse».</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
