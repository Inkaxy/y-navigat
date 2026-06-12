// POS Styring → Stasjoner: register over bong-stasjoner (f.eks. "Kaffe",
// "Kjøkken"). Produkter peker hit via products.pos_print_station_id, og
// terminaler mapper stasjon → fysisk skriver i pos_terminal_printers.

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, ScrollText } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";

interface Station {
  id: string;
  legal_entity_id: string;
  station_code: string;
  display_name: string;
  is_active: boolean;
}

const stationSchema = z.object({
  station_code: z
    .string()
    .trim()
    .min(1, "Påkrevd")
    .max(32)
    .regex(/^[a-z0-9_-]+$/i, "Kun bokstaver, tall, _ og -"),
  display_name: z.string().trim().min(1, "Påkrevd").max(80),
  is_active: z.boolean(),
});

type StationForm = z.infer<typeof stationSchema>;

const defaultForm: StationForm = {
  station_code: "",
  display_name: "",
  is_active: true,
};

async function fetchStations(activeEntityId: string): Promise<Station[]> {
  const { data, error } = await supabase
    .from("pos_print_stations")
    .select("id, legal_entity_id, station_code, display_name, is_active")
    .eq("legal_entity_id", activeEntityId)
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Station[];
}

export default function Stasjoner() {
  const { activeEntityId, activeEntity } = useLegalEntity();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Station | null>(null);

  const { data: stations = [], isLoading } = useQuery({
    queryKey: ["pos_print_stations", activeEntityId],
    queryFn: () => fetchStations(activeEntityId!),
    enabled: !!activeEntityId,
  });

  const form = useForm<StationForm>({
    resolver: zodResolver(stationSchema),
    defaultValues: defaultForm,
  });

  const openCreate = () => {
    setEditing(null);
    form.reset(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (s: Station) => {
    setEditing(s);
    form.reset({
      station_code: s.station_code,
      display_name: s.display_name,
      is_active: s.is_active,
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: StationForm) => {
      if (editing) {
        const { error } = await supabase
          .from("pos_print_stations")
          .update({
            station_code: values.station_code.trim(),
            display_name: values.display_name.trim(),
            is_active: values.is_active,
          })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        if (!activeEntityId) throw new Error("Mangler aktiv enhet");
        const { error } = await supabase.from("pos_print_stations").insert({
          legal_entity_id: activeEntityId,
          station_code: values.station_code.trim(),
          display_name: values.display_name.trim(),
          is_active: values.is_active,
        });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_print_stations", activeEntityId] });
      toast.success(editing ? "Stasjon oppdatert" : "Stasjon opprettet");
      setDialogOpen(false);
    },
    onError: (e) =>
      toast.error("Kunne ikke lagre", { description: e instanceof Error ? e.message : "Ukjent feil" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pos_print_stations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_print_stations", activeEntityId] });
      toast.success("Stasjon slettet");
      setDeleteTarget(null);
    },
    onError: (e) =>
      toast.error("Kunne ikke slette", { description: e instanceof Error ? e.message : "Ukjent feil" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">Stasjoner</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeEntity ? `${activeEntity.short_code} — ${activeEntity.legal_name}` : "Velg aktiv enhet"} ·
            Bong-stasjoner (f.eks. Kaffe, Kjøkken) som mapper til fysiske skrivere per terminal.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Ny stasjon
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : stations.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <ScrollText className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Ingen stasjoner</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Opprett stasjoner (f.eks. «Kaffe», «Kjøkken») og koble dem til produkter i Produkter-listen.
            Per terminal kobles stasjonen til en fysisk skriver.
          </p>
          <Button onClick={openCreate} className="mt-2">
            <Plus className="h-4 w-4" /> Ny stasjon
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Visningsnavn</TableHead>
                <TableHead>Kode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32 text-right">Handling</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stations.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.display_name}</TableCell>
                  <TableCell className="font-mono text-xs">{s.station_code}</TableCell>
                  <TableCell>
                    <Badge variant={s.is_active ? "default" : "secondary"}>
                      {s.is_active ? "Aktiv" : "Av"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(s)}>Rediger</DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(s)}
                        >
                          Slett
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Rediger stasjon" : "Ny stasjon"}</DialogTitle>
            <DialogDescription>
              Stasjonen vises på produkter og mappes til en fysisk skriver per terminal.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="display_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Visningsnavn</FormLabel>
                  <FormControl><Input {...field} placeholder="Kaffe" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="station_code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Kode</FormLabel>
                  <FormControl><Input {...field} placeholder="kaffe" /></FormControl>
                  <FormDescription className="text-xs">Intern kode — kun bokstaver, tall, _ og -.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="is_active" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel>Aktiv</FormLabel>
                    <FormDescription className="text-xs">Inaktive stasjoner brukes ikke ved salg.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )} />
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Avbryt</Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Lagrer…" : "Lagre"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette «{deleteTarget?.display_name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Produkter som peker hit må endres manuelt. Terminal-mappinger for stasjonen blir også fjernet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
