// Maler/tema-dialog for TastaturEditor. "Bruk mal" overskriver alt (pages,
// buttons, theme, customer_screen, grid). "Bruk tema" rører kun theme +
// customer_screen-jsonb. Hver knapp har sin egen bekreft-dialog.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Palette, Sparkles } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { KioskRender } from "@/kiosk/render/KioskRender";
import { TEMPLATES, type KeypadTemplate } from "@/pos_styring/keypad/templates";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layoutId: string;
  currentGridCols: number;
  currentGridRows: number;
}

type Action = { kind: "template"; template: KeypadTemplate } | { kind: "theme"; template: KeypadTemplate };

export function TemplatesDialog({ open, onOpenChange, layoutId, currentGridCols, currentGridRows }: Props) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Action | null>(null);

  const applyTemplate = useMutation({
    mutationFn: async (tpl: KeypadTemplate) => {
      // 1. Slett eksisterende sider (cascade tar knapper).
      const { error: delErr } = await supabase
        .from("pos_keypad_pages")
        .delete()
        .eq("layout_id", layoutId);
      if (delErr) throw delErr;

      // 2. Oppdater layout — grid + theme + customer_screen.
      const { error: layoutErr } = await supabase
        .from("pos_keypad_layouts")
        .update({
          grid_cols: tpl.gridCols,
          grid_rows: tpl.gridRows,
          theme: tpl.theme as unknown as never,
          customer_screen: tpl.customerScreen as unknown as never,
          updated_at: new Date().toISOString(),
        })
        .eq("id", layoutId);
      if (layoutErr) throw layoutErr;

      // 3. To-pass insert: (a) opprett alle sider og bygg key→nyUUID-map,
      //    (b) sett inn knapper med target_page_id slått opp fra map (for
      //    kategori-knapper som peker på en annen template-side).
      const pageIdByKey = new Map<string, string>();

      for (let i = 0; i < tpl.pages.length; i++) {
        const page = tpl.pages[i];
        const { data: inserted, error: pageErr } = await supabase
          .from("pos_keypad_pages")
          .insert({
            layout_id: layoutId,
            page_name: page.page_name,
            sort_order: i,
            background_color: page.background_color,
            icon: page.icon,
          })
          .select("id")
          .single();
        if (pageErr) throw pageErr;
        pageIdByKey.set(page.page_name, inserted.id);
      }

      for (const page of tpl.pages) {
        const newPageId = pageIdByKey.get(page.page_name);
        if (!newPageId || page.buttons.length === 0) continue;
        const rows = page.buttons.map((b) => ({
          page_id: newPageId,
          button_type: b.button_type,
          function_code: b.function_code ?? null,
          display_label: b.display_label,
          background_color: b.background_color ?? null,
          text_color: b.text_color ?? null,
          target_page_id: b.targetPageKey ? pageIdByKey.get(b.targetPageKey) ?? null : null,
          grid_x: b.grid_x,
          grid_y: b.grid_y,
          grid_width: b.grid_width,
          grid_height: b.grid_height,
        }));
        const { error: btnErr } = await supabase.from("pos_keypad_buttons").insert(rows);
        if (btnErr) throw btnErr;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pos_keypad_layout", layoutId] }),
        queryClient.invalidateQueries({ queryKey: ["pos_keypad_pages", layoutId] }),
        queryClient.invalidateQueries({ queryKey: ["pos_keypad_buttons"] }),
      ]);
      toast.success("Mal aktivert");
      setPending(null);
      onOpenChange(false);
    },
    onError: (e) => toast.error("Kunne ikke aktivere mal", { description: (e as Error).message }),
  });

  const applyTheme = useMutation({
    mutationFn: async (tpl: KeypadTemplate) => {
      const { error } = await supabase
        .from("pos_keypad_layouts")
        .update({
          theme: tpl.theme as unknown as never,
          customer_screen: tpl.customerScreen as unknown as never,
          updated_at: new Date().toISOString(),
        })
        .eq("id", layoutId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_layout", layoutId] });
      toast.success("Tema oppdatert");
      setPending(null);
    },
    onError: (e) => toast.error("Kunne ikke oppdatere tema", { description: (e as Error).message }),
  });

  const handleConfirm = () => {
    if (!pending) return;
    if (pending.kind === "template") applyTemplate.mutate(pending.template);
    else applyTheme.mutate(pending.template);
  };

  const busy = applyTemplate.isPending || applyTheme.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Maler & tema</DialogTitle>
            <DialogDescription>
              "Bruk mal" oppretter sider, eksempel-knapper og setter tema. Eksisterende oppsett overskrives.
              "Bruk tema" endrer kun farger/typografi — knappene står.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-3">
            {TEMPLATES.map((tpl) => (
              <div
                key={tpl.key}
                className="flex flex-col overflow-hidden rounded-lg border bg-card shadow-card"
              >
                <div className="aspect-[4/3] border-b" style={{ background: tpl.theme.bg }}>
                  <div className="h-full w-full origin-top-left scale-[0.42]" style={{ width: "238%", height: "238%" }}>
                    <KioskRender
                      theme={tpl.theme}
                      gridCols={tpl.gridCols}
                      gridRows={tpl.gridRows}
                      pages={tpl.pages.map((p, i) => ({
                        id: `tpl-${tpl.key}-${i}`,
                        page_name: p.page_name,
                        sort_order: i,
                        background_color: p.background_color,
                        icon: p.icon,
                      }))}
                      buttons={tpl.pages.flatMap((p, i) =>
                        p.buttons.map((b, j) => ({
                          id: `tpl-${tpl.key}-${i}-${j}`,
                          page_id: `tpl-${tpl.key}-${i}`,
                          button_type: b.button_type,
                          display_label: b.display_label,
                          image_url: null,
                          background_color: b.background_color ?? null,
                          text_color: b.text_color ?? null,
                          grid_x: b.grid_x,
                          grid_y: b.grid_y,
                          grid_width: b.grid_width,
                          grid_height: b.grid_height,
                        })),
                      )}
                      currentPageId={`tpl-${tpl.key}-0`}
                      headerLabel={tpl.name}
                    />
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <h3 className="text-base font-semibold">{tpl.name}</h3>
                    <p className="text-xs text-muted-foreground">{tpl.tagline}</p>
                  </div>
                  <p className="flex-1 text-sm text-muted-foreground">{tpl.description}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setPending({ kind: "theme", template: tpl })}
                    >
                      <Palette className="h-4 w-4" /> Bruk tema
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => setPending({ kind: "template", template: tpl })}
                    >
                      <Sparkles className="h-4 w-4" /> Bruk mal
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700">
            <Check className="h-4 w-4" />
            Nåværende grid: {currentGridCols} × {currentGridRows}. "Bruk mal" endrer dette til malens grid.
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "template"
                ? `Aktivere "${pending.template.name}"?`
                : `Bruke "${pending?.template.name}"-tema?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "template" ? (
                <>
                  Alle eksisterende sider og knapper på dette layoutet slettes og erstattes av malen.
                  Grid endres til {pending.template.gridCols} × {pending.template.gridRows}. Dette kan ikke angres.
                </>
              ) : (
                <>
                  Kun farger, typografi og kundeskjerm-oppsett endres. Sider og knapper står urørt.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              disabled={busy}
              className={cn(pending?.kind === "template" && "bg-destructive hover:bg-destructive/90")}
            >
              {busy ? "Aktiverer…" : pending?.kind === "template" ? "Overskriv og aktiver" : "Bruk tema"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
