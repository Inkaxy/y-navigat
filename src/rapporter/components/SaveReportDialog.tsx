import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSaveReportDefinition } from "@/rapporter/hooks/useReportDefinitions";
import type { ReportConfig, ReportKind } from "@/rapporter/lib/reportConfig";

/** «Lagre som rapport» — lagrer sidens gjeldende utvalg som en delt rapportdefinisjon. */
export function SaveReportDialog({
  kind,
  config,
  label = "Lagre som rapport",
}: {
  kind: ReportKind;
  /** Funksjon slik at vi alltid fanger utvalget i det dialogen åpnes. */
  config: () => ReportConfig;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [favorite, setFavorite] = useState(false);
  const save = useSaveReportDefinition();

  const submit = async () => {
    if (!name.trim()) return;
    await save.mutateAsync({ displayName: name, kind, config: config(), isFavorite: favorite });
    setOpen(false);
    setName("");
    setFavorite(false);
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Save className="mr-2 h-4 w-4" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lagre som rapport</DialogTitle>
            <DialogDescription>
              Utvalget lagres slik det står nå, og blir tilgjengelig for alle i selskapet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="report-name">Navn</Label>
              <Input
                id="report-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="F.eks. NG-salg denne måneden"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="report-fav"
                checked={favorite}
                onCheckedChange={(v) => setFavorite(v === true)}
              />
              <Label htmlFor="report-fav" className="font-normal">
                Marker som favoritt
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Avbryt
            </Button>
            <Button onClick={() => void submit()} disabled={!name.trim() || save.isPending}>
              Lagre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
