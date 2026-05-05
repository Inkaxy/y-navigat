import { useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { MultiSelectChips } from "@/components/products/detail/MultiSelectChips";
import {
  LABEL_MODE_OPTIONS,
  LABEL_MODE_HELP,
  LABEL_PRINT_MODEL_OPTIONS,
  LABEL_PRINT_MODEL_HELP,
} from "@/lib/constants";
import type { ProductFormValues } from "@/lib/productSchema";
import { CakeBuilderSection, type CakeStepLink } from "@/components/products/detail/CakeBuilderSection";

interface LookupRow {
  id: string;
  display_name: string;
}

interface DepartmentRow {
  id: string;
  code: string;
  display_name: string;
}

interface Props {
  productId: string;
  canWrite: boolean;
  productionGroups: LookupRow[];
  productionDepartments: DepartmentRow[];
  selectedDepartmentIds: string[];
  onDepartmentsChange: (ids: string[]) => void;
  cakeLinks: CakeStepLink[];
  originalCakeLinks: CakeStepLink[];
  onCakeLinksChange: (links: CakeStepLink[]) => void;
}

export function ProduksjonTab({
  productId,
  canWrite,
  productionGroups,
  productionDepartments,
  selectedDepartmentIds,
  onDepartmentsChange,
  cakeLinks,
  originalCakeLinks,
  onCakeLinksChange,
}: Props) {
  const { control, register, watch, setValue } = useFormContext<ProductFormValues>();
  const [confirmTurnOff, setConfirmTurnOff] = useState<{ pending: string } | null>(null);
  const labelMode = watch("label_mode");

  const departmentOptions = productionDepartments.map((d) => ({
    id: d.id,
    label: `${d.code} — ${d.display_name}`,
  }));

  return (
    <Card>
      <CardContent className="pt-6 grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <Label>Produksjonsgruppe</Label>
            <Controller
              control={control}
              name="production_group_id"
              render={({ field }) => (
                <Select
                  value={field.value ?? "__none"}
                  onValueChange={(v) => field.onChange(v === "__none" ? null : v)}
                  disabled={!canWrite}
                >
                  <SelectTrigger><SelectValue placeholder="Velg…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— Ingen —</SelectItem>
                    {productionGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <Controller
            control={control}
            name="is_production_group_main"
            render={({ field }) => (
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!canWrite}
                  />
                  <span className="text-sm">Produksjonsgruppens hovedvare</span>
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  Hovedvaren representerer gruppen i produksjonsplanen. Kun én vare pr gruppe bør være hovedvare.
                </p>
              </div>
            )}
          />

          <div>
            <Label>Deigtype</Label>
            <Input {...register("dough_type")} disabled={!canWrite} />
          </div>

          <div>
            <Label>Ledetid (dager)</Label>
            <Input type="number" step="1" {...register("lead_time_days")} disabled={!canWrite} />
          </div>

          <div>
            <Label>Produksjonsbuffer</Label>
            <Input type="number" step="any" {...register("production_buffer")} disabled={!canWrite} />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Antall pr liter</Label>
            <Input type="number" step="any" {...register("pieces_per_liter")} disabled={!canWrite} />
          </div>

          <div>
            <Label>Antall pr brett</Label>
            <Input type="number" step="any" {...register("pieces_per_tray")} disabled={!canWrite} />
          </div>

          <Controller
            control={control}
            name="is_warehouse_item"
            render={({ field }) => (
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={!canWrite}
                />
                <span className="text-sm">Lagervare</span>
              </label>
            )}
          />

          <div>
            <Label>Holdbarhet kjøl (dager)</Label>
            <Input type="number" step="1" {...register("shelf_life_chilled_days")} disabled={!canWrite} />
          </div>

          <div>
            <Label>Holdbarhet frys (dager)</Label>
            <Input type="number" step="1" {...register("shelf_life_frozen_days")} disabled={!canWrite} />
          </div>

          <div>
            <Label className="text-muted-foreground">Lagres som</Label>
            <Input disabled value="" placeholder="—" />
            <p className="text-xs text-muted-foreground mt-1">
              Kommer når Råvarer-appen er bygget.
            </p>
          </div>
        </div>

        {/* Etikett-seksjon — full bredde */}
        <div className="md:col-span-2 border-t border-border pt-6 mt-2">
          <h3 className="text-sm font-semibold mb-1">Etikett</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Styrer hvordan etiketter genereres for denne varen i Produksjon-appen.
          </p>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <Label>Skrive etikett</Label>
              <Controller
                control={control}
                name="label_mode"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      // Bekreft når man bytter FRA aktiv etikett TIL "ingen"
                      if (v === "none" && field.value !== "none") {
                        setConfirmTurnOff({ pending: v });
                        return;
                      }
                      field.onChange(v);
                    }}
                    disabled={!canWrite}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LABEL_MODE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {LABEL_MODE_HELP[labelMode]}
              </p>
            </div>

            <div>
              <Label>Utskriftsmodell</Label>
              <Controller
                control={control}
                name="label_print_model"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!canWrite || labelMode === "none"}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LABEL_PRINT_MODEL_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {LABEL_PRINT_MODEL_HELP[watch("label_print_model")]}
              </p>
            </div>

            <div className="md:col-span-2">
              <Label>Avdeling(er)</Label>
              {productionDepartments.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Ingen produksjonsavdelinger er opprettet ennå. Opprettes i Produksjon-app
                  (Innstillinger → Produksjonsavdelinger).
                </p>
              ) : (
                <MultiSelectChips
                  value={selectedDepartmentIds}
                  options={departmentOptions}
                  onChange={onDepartmentsChange}
                  placeholder={labelMode === "none" ? "Sett etikett-modus først…" : "Velg avdelinger…"}
                  disabled={!canWrite || labelMode === "none"}
                />
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Bestemmer hvilke produksjonsavdelinger som skriver ut etiketten.
              </p>
            </div>
          </div>
        </div>

        <CakeBuilderSection
          productId={productId}
          canWrite={canWrite}
          links={cakeLinks}
          originalLinks={originalCakeLinks}
          onLinksChange={onCakeLinksChange}
        />
      </CardContent>

      <AlertDialog open={!!confirmTurnOff} onOpenChange={(o) => !o && setConfirmTurnOff(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slå av etikett for denne varen?</AlertDialogTitle>
            <AlertDialogDescription>
              Etikett-modusen settes til «Ingen etikett». Avdeling-tilknytninger beholdes,
              men ingen etiketter vil bli generert før modusen settes tilbake.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmTurnOff) {
                  setValue("label_mode", "none", { shouldDirty: true });
                }
                setConfirmTurnOff(null);
              }}
            >
              Slå av etikett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
