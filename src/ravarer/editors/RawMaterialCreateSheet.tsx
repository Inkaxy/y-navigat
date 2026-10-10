import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { usePackageInference } from "@/fakturaer/hooks/useSupplierItems";
import { LinkResultBox } from "@/fakturaer/components/supplier-item/LinkResultBox";
import type { LinkSupplierItemResult } from "@/fakturaer/lib/supplierItems";
import { paths } from "@/ravarer/lib/paths";
import { CreateSheetFields } from "./CreateSheetFields";
import { DuplicateSuggestions } from "./DuplicateSuggestions";
import { initialDraft, validateCreate, type CreateContext, type CreateDraft } from "./createSheetLogic";
import { useCreateSheetSubmit, type CreateOutcome } from "./useCreateSheetSubmit";

export interface RawMaterialCreateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: CreateContext;
  /** Kalles med råvare-id etter opprettelse eller kobling. */
  onDone?: (rawMaterialId: string | null, outcome: CreateOutcome) => void;
}

const TITLE: Record<CreateContext["kind"], string> = {
  standalone: "Ny råvare",
  supplier_item: "Ny råvare fra varekortet",
  datasheet: "Ny råvare fra datablad",
};

/** ENESTE «Ny råvare»-flate. Skrivevei velges av `context.kind`. */
export function RawMaterialCreateSheet({ open, onOpenChange, context, onDone }: RawMaterialCreateSheetProps) {
  const navigate = useNavigate();
  const { data: suppliers = [] } = useSuppliers();
  const [draft, setDraft] = useState<CreateDraft>(() => initialDraft(context));
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<LinkSupplierItemResult | null>(null);
  const { submit, useExisting, isPending } = useCreateSheetSubmit(context);
  const firstLine = context.kind === "supplier_item" ? (context.lineIds?.[0] ?? null) : null;
  const inference = usePackageInference(open ? firstLine : null, null);

  useEffect(() => {
    if (open) { setDraft(initialDraft(context)); setError(null); setLinked(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nullstill bare ved åpning
  }, [open]);

  const set = (patch: Partial<CreateDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const finish = (o: CreateOutcome) => {
    if (o.kind === "linked") {
      setLinked(o.result);
      onDone?.(o.result.raw_material_id, o);
      return;
    }
    onDone?.(o.rawMaterialId, o);
    onOpenChange(false);
    if (draft.openAfterSave) navigate(paths.raavare(o.rawMaterialId));
  };

  const save = async () => {
    const v = validateCreate(draft);
    if (v) { setError(v); return; }
    setError(null);
    try { finish(await submit(draft)); } catch (e) { toast.error(e instanceof Error ? e.message : "Kunne ikke lagre"); }
  };

  const pickExisting = async (id: string) => {
    try { finish(await useExisting(id)); } catch (e) { toast.error(e instanceof Error ? e.message : "Kunne ikke koble"); }
  };

  const ai = context.kind === "datasheet"
    ? {
        name: context.aiFields.name ? (context.aiFields.confidence?.name ?? null) : undefined,
        sku: context.aiFields.sku ? (context.aiFields.confidence?.sku ?? null) : undefined,
        package: context.aiFields.package_size_value != null ? (context.aiFields.confidence?.package ?? null) : undefined,
      }
    : undefined;
  const hint = inference.data?.explanation ? `Forslag fra fakturalinjen: ${inference.data.explanation}` : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[560px]">
        <SheetHeader className="border-b p-5 text-left">
          <SheetTitle>{TITLE[context.kind]}</SheetTitle>
          <SheetDescription>
            {context.kind === "supplier_item"
              ? "Alle åpne linjer på varekortet kobles og regnes om."
              : context.kind === "datasheet"
                ? `Forhåndsutfylt fra ${context.fileName}. Kontroller før du lagrer.`
                : "Bare navn og grunnenhet er påkrevd."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 p-5">
          {linked ? (
            <LinkResultBox result={linked} onClose={() => onOpenChange(false)} />
          ) : (
            <>
              <DuplicateSuggestions
                name={draft.name}
                useLabel={context.kind === "supplier_item" ? "Koble til denne" : "Bruk denne"}
                onUse={(id) => {
                  if (context.kind === "supplier_item") void pickExisting(id);
                  else { onOpenChange(false); navigate(paths.raavare(id)); }
                }}
              />
              <CreateSheetFields draft={draft} set={set} suppliers={suppliers} ai={ai} baseUnitHint={hint} showSupplier={context.kind === "standalone"} />
              <label className="flex items-center justify-between gap-2 text-sm">
                Åpne råvarekortet etter lagring
                <Switch checked={draft.openAfterSave} onCheckedChange={(v) => set({ openAfterSave: v })} disabled={context.kind === "supplier_item"} />
              </label>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            </>
          )}
        </div>
        {!linked && (
          <SheetFooter className="border-t p-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
            <Button onClick={save} disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {context.kind === "supplier_item" ? "Opprett og koble" : "Opprett råvare"}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
