import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ExternalLink, Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import {
  useApplyMatvaretabellen,
  useMatvaretabellenFood,
  useUnlinkMatvaretabellen,
} from "@/ravarer/hooks/useMatvaretabellen";
import { FoodPickerDialog } from "./FoodPickerDialog";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { Badge } from "@/components/ui/badge";
import { normalizeNutritionSource } from "@/ravarer/lib/nutritionSource";

interface Props {
  rawMaterialId: string;
  /** raw_material_nutrition.source */
  source: string | null;
  /** raw_material_nutrition.matvaretabellen_food_id */
  foodId: string | null;
}

export function MatvaretabellenSourceCard({ rawMaterialId, source, foodId }: Props) {
  const { canWrite } = useRavarer();
  // Koblingen består selv om noen har rettet et tall manuelt — da er kilden «manuell».
  const linked = !!foodId;
  const manualOverride = linked && normalizeNutritionSource(source) !== "matvaretabellen";
  const { data: food } = useMatvaretabellenFood(linked ? foodId : null);
  const apply = useApplyMatvaretabellen();
  const unlink = useUnlinkMatvaretabellen();

  const [findOpen, setFindOpen] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);

  if (!linked) {
    return (
      <>
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-ink-secondary">
            Ikke koblet til Matvaretabellen. Du kan hente offisielle næringsverdier per 100 g.
          </p>
          {canWrite && (
            <Button variant="outline" size="sm" onClick={() => setFindOpen(true)}>
              <Link2 className="mr-1.5 h-3.5 w-3.5" /> Finn i Matvaretabellen
            </Button>
          )}
        </Card>
        {findOpen && (
          <FoodPickerDialog
            open={findOpen}
            onOpenChange={setFindOpen}
            rawMaterialId={rawMaterialId}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Card
        className={`flex flex-wrap items-center justify-between gap-3 p-4 ${
          manualOverride ? "border-warning/30 bg-warning/5" : "border-success/30 bg-success/5"
        }`}
      >
        <div className="text-sm">
          <span className="font-medium">Kilde: {manualOverride ? "Manuell" : "Matvaretabellen"}</span>
          {manualOverride && (
            <Badge variant="outline" className="ml-2">
              Manuelt overstyrt
            </Badge>
          )}
          {food?.food_name ? <span> — {food.food_name}</span> : null}
          {food?.uri && (
            <a
              href={food.uri}
              target="_blank"
              rel="noreferrer"
              className="ml-2 inline-flex items-center gap-1 text-xs underline underline-offset-2"
            >
              Åpne <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={apply.isPending}
              onClick={() => (manualOverride ? setConfirmRefresh(true) : apply.mutate({ rawMaterialId, foodId: foodId! }))}
            >
              {apply.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Oppdater verdier
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmUnlink(true)}>
              <Unlink className="mr-1.5 h-3.5 w-3.5" /> Koble fra
            </Button>
          </div>
        )}
      </Card>

      <AlertDialog open={confirmRefresh} onOpenChange={setConfirmRefresh}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overskrive manuelle verdier?</AlertDialogTitle>
            <AlertDialogDescription>
              Næringsverdiene er rettet manuelt etter at råvaren ble koblet. Henter du på nytt, erstattes de med
              tallene fra Matvaretabellen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Behold mine verdier</AlertDialogCancel>
            <AlertDialogAction onClick={() => apply.mutate({ rawMaterialId, foodId: foodId! })}>
              Hent på nytt
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Koble fra Matvaretabellen?</AlertDialogTitle>
            <AlertDialogDescription>
              Verdiene beholdes på råvaren, men kilden settes til «manuell» og koblingen fjernes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => unlink.mutate(rawMaterialId)}>Koble fra</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
