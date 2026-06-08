import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Grid3X3, MoreHorizontal, PenLine, Plus, Star, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const NO_TERMINAL = "__standalone__";

interface KeypadLayout {
  id: string;
  display_name: string;
  grid_cols: number;
  grid_rows: number;
  is_default: boolean;
  terminal_id: string | null;
  updated_at: string;
  terminal?: { display_name: string } | null;
  pages?: { count: number }[];
  firstPage?: KeypadPagePreview | null;
  previewButtons?: KeypadButtonPreview[];
}

interface TerminalOption {
  id: string;
  display_name: string;
  terminal_code: string;
}

interface KeypadPagePreview {
  id: string;
  page_name: string;
  sort_order: number;
  background_color: string | null;
}

interface KeypadButtonPreview {
  id: string;
  page_id: string;
  button_type: string;
  display_label: string | null;
  function_code: string | null;
  background_color: string | null;
  text_color: string | null;
  grid_x: number;
  grid_y: number;
  grid_width: number;
  grid_height: number;
}

const layoutSchema = z.object({
  display_name: z.string().trim().min(1, "Navn er påkrevd").max(100, "Maks 100 tegn"),
  grid_cols: z.coerce.number().int().min(3, "Minst 3 kolonner").max(12, "Maks 12 kolonner"),
  grid_rows: z.coerce.number().int().min(3, "Minst 3 rader").max(10, "Maks 10 rader"),
  terminal_id: z.string(),
  is_default: z.boolean(),
});

type LayoutFormValues = z.infer<typeof layoutSchema>;

function pageCount(layout: KeypadLayout) {
  return layout.pages?.[0]?.count ?? 0;
}

async function fetchLayouts(activeEntityId: string): Promise<KeypadLayout[]> {
  const { data, error } = await supabase
    .from("pos_keypad_layouts")
    .select("id, display_name, grid_cols, grid_rows, is_default, terminal_id, updated_at, terminal:pos_terminals!pos_keypad_layouts_terminal_id_fkey(display_name), pages:pos_keypad_pages(count)")
    .eq("legal_entity_id", activeEntityId)
    .order("is_default", { ascending: false })
    .order("display_name", { ascending: true });

  if (error) throw error;
  const layouts = (data ?? []) as unknown as KeypadLayout[];
  if (layouts.length === 0) return [];

  const layoutIds = layouts.map((layout) => layout.id);
  const { data: pagesData, error: pagesError } = await supabase
    .from("pos_keypad_pages")
    .select("id, layout_id, page_name, sort_order, background_color")
    .in("layout_id", layoutIds)
    .order("sort_order", { ascending: true });
  if (pagesError) throw pagesError;

  const firstPageByLayout = new Map<string, KeypadPagePreview>();
  for (const page of (pagesData ?? []) as Array<KeypadPagePreview & { layout_id: string }>) {
    if (!firstPageByLayout.has(page.layout_id)) firstPageByLayout.set(page.layout_id, page);
  }

  const firstPageIds = Array.from(firstPageByLayout.values()).map((page) => page.id);
  const buttonsByPage = new Map<string, KeypadButtonPreview[]>();
  if (firstPageIds.length > 0) {
    const { data: buttonsData, error: buttonsError } = await supabase
      .from("pos_keypad_buttons")
      .select("id, page_id, button_type, display_label, function_code, background_color, text_color, grid_x, grid_y, grid_width, grid_height")
      .in("page_id", firstPageIds);
    if (buttonsError) throw buttonsError;
    for (const button of (buttonsData ?? []) as KeypadButtonPreview[]) {
      buttonsByPage.set(button.page_id, [...(buttonsByPage.get(button.page_id) ?? []), button]);
    }
  }

  return layouts.map((layout) => {
    const firstPage = firstPageByLayout.get(layout.id) ?? null;
    return {
      ...layout,
      firstPage,
      previewButtons: firstPage ? buttonsByPage.get(firstPage.id) ?? [] : [],
    };
  });
}

async function fetchTerminals(activeEntityId: string): Promise<TerminalOption[]> {
  const { data, error } = await supabase
    .from("pos_terminals")
    .select("id, display_name, terminal_code")
    .eq("legal_entity_id", activeEntityId)
    .order("terminal_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TerminalOption[];
}

function KeypadPreview({ layout }: { layout: KeypadLayout }) {
  const buttons = layout.previewButtons ?? [];
  return (
    <div
      className="grid aspect-[4/3] rounded-md border bg-muted/40 p-1"
      style={{ gridTemplateColumns: `repeat(${layout.grid_cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.grid_rows}, minmax(0, 1fr))` }}
      aria-label={`Miniatyr av ${layout.display_name}`}
    >
      {Array.from({ length: layout.grid_cols * layout.grid_rows }).map((_, index) => (
        <div key={index} className="m-0.5 rounded-sm border border-border/60 bg-background/70" />
      ))}
      {buttons.map((button) => (
        <div
          key={button.id}
          className="m-0.5 overflow-hidden rounded-sm border border-primary/30 bg-primary/15 text-[10px] font-medium text-foreground"
          style={{
            gridColumn: `${button.grid_x + 1} / span ${button.grid_width}`,
            gridRow: `${button.grid_y + 1} / span ${button.grid_height}`,
            backgroundColor: button.background_color ?? undefined,
            color: button.text_color ?? undefined,
          }}
        >
          <span className="line-clamp-2 px-1 py-0.5">{button.display_label || button.function_code || button.button_type}</span>
        </div>
      ))}
    </div>
  );
}

interface LayoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: KeypadLayout | null;
  activeEntityId: string;
  terminals: TerminalOption[];
}

function LayoutDialog({ open, onOpenChange, layout, activeEntityId, terminals }: LayoutDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!layout;
  const form = useForm<LayoutFormValues>({
    resolver: zodResolver(layoutSchema),
    defaultValues: {
      display_name: "",
      grid_cols: 6,
      grid_rows: 5,
      terminal_id: NO_TERMINAL,
      is_default: false,
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      display_name: layout?.display_name ?? "",
      grid_cols: layout?.grid_cols ?? 6,
      grid_rows: layout?.grid_rows ?? 5,
      terminal_id: layout?.terminal_id ?? NO_TERMINAL,
      is_default: layout?.is_default ?? false,
    });
  }, [form, layout, open]);

  const saveMutation = useMutation({
    mutationFn: async (values: LayoutFormValues) => {
      if (values.is_default) {
        const { error: unsetError } = await supabase
          .from("pos_keypad_layouts")
          .update({ is_default: false, updated_at: new Date().toISOString() })
          .eq("legal_entity_id", activeEntityId);
        if (unsetError) throw unsetError;
      }

      const payload = {
        display_name: values.display_name.trim(),
        grid_cols: values.grid_cols,
        grid_rows: values.grid_rows,
        terminal_id: values.terminal_id === NO_TERMINAL ? null : values.terminal_id,
        is_default: values.is_default,
        updated_at: new Date().toISOString(),
      };

      if (isEdit) {
        const { error } = await supabase.from("pos_keypad_layouts").update(payload).eq("id", layout.id);
        if (error) throw error;
        return layout.id;
      }

      const { data, error } = await supabase
        .from("pos_keypad_layouts")
        .insert({ ...payload, legal_entity_id: activeEntityId })
        .select("id")
        .single();
      if (error) throw error;

      const { error: pageError } = await supabase.from("pos_keypad_pages").insert({
        layout_id: data.id,
        page_name: "Hovedside",
        sort_order: 0,
      });
      if (pageError) throw pageError;
      return data.id;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_layouts", activeEntityId] });
      onOpenChange(false);
      toast.success("Layout lagret");
      if (!isEdit) navigate(`/tastatur/${id}`);
    },
    onError: (error) => toast.error("Kunne ikke lagre layout", { description: error instanceof Error ? error.message : "Ukjent feil" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rediger layout" : "Nytt layout"}</DialogTitle>
          <DialogDescription>Velg grid-størrelse og eventuell terminal-binding.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="space-y-4">
            <FormField control={form.control} name="display_name" render={({ field }) => (
              <FormItem>
                <FormLabel>Navn</FormLabel>
                <FormControl><Input {...field} placeholder="Kasse hovedlayout" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="grid_cols" render={({ field }) => (
                <FormItem>
                  <FormLabel>Kolonner</FormLabel>
                  <FormControl><Input type="number" min={3} max={12} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="grid_rows" render={({ field }) => (
                <FormItem>
                  <FormLabel>Rader</FormLabel>
                  <FormControl><Input type="number" min={3} max={10} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="terminal_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Terminal</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={NO_TERMINAL}>Frittstående (ingen terminal-binding)</SelectItem>
                    {terminals.map((terminal) => (
                      <SelectItem key={terminal.id} value={terminal.id}>{terminal.terminal_code} — {terminal.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="is_default" render={({ field }) => (
              <FormItem className="flex items-center gap-3 rounded-md border p-3">
                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Sett som default for entity</FormLabel>
                </div>
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
              <Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? "Lagrer…" : "Lagre"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function CopyLayoutDialog({ layout, activeEntityId, onOpenChange }: { layout: KeypadLayout | null; activeEntityId: string; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  useEffect(() => {
    setName(layout ? `Kopi av ${layout.display_name}` : "");
  }, [layout]);

  const copyMutation = useMutation({
    mutationFn: async () => {
      if (!layout) return;
      const { data: newLayout, error: layoutError } = await supabase
        .from("pos_keypad_layouts")
        .insert({
          legal_entity_id: activeEntityId,
          terminal_id: null,
          display_name: name.trim(),
          grid_cols: layout.grid_cols,
          grid_rows: layout.grid_rows,
          is_default: false,
        })
        .select("id")
        .single();
      if (layoutError) throw layoutError;

      const { data: pages, error: pagesError } = await supabase
        .from("pos_keypad_pages")
        .select("id, page_name, sort_order, background_color")
        .eq("layout_id", layout.id)
        .order("sort_order", { ascending: true });
      if (pagesError) throw pagesError;

      for (const page of pages ?? []) {
        const { data: newPage, error: pageError } = await supabase
          .from("pos_keypad_pages")
          .insert({ layout_id: newLayout.id, page_name: page.page_name, sort_order: page.sort_order, background_color: page.background_color })
          .select("id")
          .single();
        if (pageError) throw pageError;

        const { data: buttons, error: buttonsError } = await supabase
          .from("pos_keypad_buttons")
          .select("button_type, product_id, function_code, display_label, image_url, background_color, text_color, grid_x, grid_y, grid_width, grid_height")
          .eq("page_id", page.id);
        if (buttonsError) throw buttonsError;
        if (buttons && buttons.length > 0) {
          const { error: insertButtonsError } = await supabase.from("pos_keypad_buttons").insert(buttons.map((button) => ({ ...button, page_id: newPage.id })));
          if (insertButtonsError) throw insertButtonsError;
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_layouts", activeEntityId] });
      toast.success("Layout kopiert");
      onOpenChange(false);
    },
    onError: (error) => toast.error("Kunne ikke kopiere layout", { description: error instanceof Error ? error.message : "Ukjent feil" }),
  });

  return (
    <Dialog open={!!layout} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kopier layout</DialogTitle>
          <DialogDescription>Ny kopi opprettes som frittstående og ikke-default.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="copy-layout-name">Nytt navn</label>
          <Input id="copy-layout-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={() => copyMutation.mutate()} disabled={!name.trim() || copyMutation.isPending}>Kopier</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Tastatur() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeEntityId, activeEntity, isLoading: entityLoading } = useLegalEntity();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLayout, setEditingLayout] = useState<KeypadLayout | null>(null);
  const [copyingLayout, setCopyingLayout] = useState<KeypadLayout | null>(null);
  const [deletingLayout, setDeletingLayout] = useState<KeypadLayout | null>(null);

  const { data: layouts = [], isLoading, error } = useQuery({
    queryKey: ["pos_keypad_layouts", activeEntityId],
    queryFn: () => fetchLayouts(activeEntityId!),
    enabled: !!activeEntityId,
  });

  const { data: terminals = [] } = useQuery({
    queryKey: ["pos_keypad_terminals", activeEntityId],
    queryFn: () => fetchTerminals(activeEntityId!),
    enabled: !!activeEntityId,
  });

  const defaultMutation = useMutation({
    mutationFn: async (layout: KeypadLayout) => {
      if (!activeEntityId) return;
      const now = new Date().toISOString();
      const { error: unsetError } = await supabase.from("pos_keypad_layouts").update({ is_default: false, updated_at: now }).eq("legal_entity_id", activeEntityId);
      if (unsetError) throw unsetError;
      const { error: setError } = await supabase.from("pos_keypad_layouts").update({ is_default: true, updated_at: now }).eq("id", layout.id);
      if (setError) throw setError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_layouts", activeEntityId] });
      toast.success("Default-layout oppdatert");
    },
    onError: (error) => toast.error("Kunne ikke sette default", { description: error instanceof Error ? error.message : "Ukjent feil" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (layout: KeypadLayout) => {
      if (layout.is_default) throw new Error("Default-layout kan ikke slettes. Sett en annen layout som default først.");
      const { error: deleteError } = await supabase.from("pos_keypad_layouts").delete().eq("id", layout.id);
      if (deleteError) throw deleteError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_keypad_layouts", activeEntityId] });
      toast.success("Layout slettet");
      setDeletingLayout(null);
    },
    onError: (error) => toast.error("Kunne ikke slette layout", { description: error instanceof Error ? error.message : "Ukjent feil" }),
  });

  const subtitle = activeEntity ? `${activeEntity.short_code} — ${activeEntity.legal_name}` : "Velg aktiv entity";

  if (entityLoading || isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-80" />
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-72" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">Tastatur-layouts</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button onClick={() => { setEditingLayout(null); setDialogOpen(true); }} disabled={!activeEntityId}>
          <Plus className="h-4 w-4" /> Nytt layout
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <Grid3X3 className="h-4 w-4" />
          <AlertTitle>Kunne ikke laste layouts</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : "Ukjent feil"}</AlertDescription>
        </Alert>
      ) : layouts.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center shadow-card">
          <Grid3X3 className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">Ingen tastatur-layouts for {activeEntity?.short_code ?? "valgt entity"}</h2>
          <p className="mt-2 text-sm text-muted-foreground">Opprett første layout med «Nytt layout».</p>
          <Button className="mt-6" onClick={() => setDialogOpen(true)} disabled={!activeEntityId}>
            <Plus className="h-4 w-4" /> Nytt layout
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {layouts.map((layout) => (
            <Card key={layout.id} className="overflow-hidden shadow-card transition-shadow hover:shadow-elevated">
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="truncate text-xl tracking-normal">{layout.display_name}</CardTitle>
                    {layout.is_default && <Badge className="bg-primary text-primary-foreground hover:bg-primary">Default</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{layout.grid_cols} × {layout.grid_rows} grid</span>
                    <span>•</span>
                    <span>{pageCount(layout)} sider</span>
                    <span>•</span>
                    <span>{layout.terminal?.display_name ?? "Frittstående"}</span>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Layout-handlinger">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => navigate(`/tastatur/${layout.id}`)}>
                      <PenLine className="mr-2 h-4 w-4" /> Rediger editor
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setEditingLayout(layout); setDialogOpen(true); }}>
                      <Grid3X3 className="mr-2 h-4 w-4" /> Rediger metadata
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setCopyingLayout(layout)}>
                      <Copy className="mr-2 h-4 w-4" /> Kopier
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={layout.is_default} onClick={() => defaultMutation.mutate(layout)}>
                      <Star className="mr-2 h-4 w-4" /> Sett som default
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingLayout(layout)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Slett
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent className="space-y-4">
                <button className="block w-full text-left" onClick={() => navigate(`/tastatur/${layout.id}`)}>
                  <KeypadPreview layout={layout} />
                </button>
                <Button variant="outline" className="w-full" onClick={() => navigate(`/tastatur/${layout.id}`)}>
                  Åpne editor
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeEntityId && (
        <LayoutDialog open={dialogOpen} onOpenChange={setDialogOpen} layout={editingLayout} activeEntityId={activeEntityId} terminals={terminals} />
      )}
      {activeEntityId && <CopyLayoutDialog layout={copyingLayout} activeEntityId={activeEntityId} onOpenChange={(open) => !open && setCopyingLayout(null)} />}
      <AlertDialog open={!!deletingLayout} onOpenChange={(open) => !open && setDeletingLayout(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett layout?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingLayout?.is_default
                ? "Default-layout kan ikke slettes. Sett en annen layout som default først."
                : "Dette sletter layoutet med alle sider og knapper. Handlingen kan ikke angres."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className={cn(!deletingLayout?.is_default && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              disabled={deletingLayout?.is_default || deleteMutation.isPending}
              onClick={() => deletingLayout && deleteMutation.mutate(deletingLayout)}
            >
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
