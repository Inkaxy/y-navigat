import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Info, MoreHorizontal, PenLine, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLegalEntity } from "@/contexts/LegalEntityContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type TerminalStatus = "active" | "inactive" | "maintenance";

interface Terminal {
  id: string;
  terminal_code: string;
  display_name: string;
  receipt_prefix: string;
  status: TerminalStatus;
  next_receipt_number: number;
  next_session_number: number;
  next_z_number: number;
  outlet_id: string;
  default_price_list_id: string | null;
  updated_at: string;
  outlet?: {
    display_name: string;
    pos_display_name: string | null;
  } | null;
  price_list?: {
    display_name: string;
  } | null;
}

interface PickupLocationOption {
  id: string;
  display_name: string;
  pos_display_name: string | null;
}

interface PriceListOption {
  id: string;
  display_name: string;
  is_default: boolean;
}

const NO_PRICE_LIST = "__none__";

const terminalSchema = z.object({
  terminal_code: z
    .string()
    .trim()
    .min(1, "Terminal-kode er påkrevd")
    .max(20, "Maks 20 tegn")
    .regex(/^[A-Z0-9_-]{1,20}$/i, "Kun bokstaver, tall, bindestrek og understrek"),
  display_name: z.string().trim().min(1, "Visningsnavn er påkrevd").max(100, "Maks 100 tegn"),
  outlet_id: z.string().uuid("Velg utsalg"),
  default_price_list_id: z.string(),
  receipt_prefix: z
    .string()
    .trim()
    .min(1, "Kvittering-prefiks er påkrevd")
    .max(10, "Maks 10 tegn")
    .regex(/^[A-Z0-9-]{1,10}$/i, "Kun bokstaver, tall og bindestrek"),
  status: z.enum(["active", "inactive", "maintenance"]),
});

type TerminalFormValues = z.infer<typeof terminalSchema>;

function formatOutletName(location?: Terminal["outlet"] | PickupLocationOption | null) {
  if (!location) return "—";
  return location.pos_display_name || location.display_name;
}

function getSupabaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: string }).code)
    : null;
}

function getSupabaseErrorMessage(error: unknown) {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: string }).message)
    : "Ukjent feil";
}

function StatusBadge({ status }: { status: TerminalStatus }) {
  const config = {
    active: "border-success/30 bg-success/10 text-success",
    inactive: "border-muted bg-muted text-muted-foreground",
    maintenance: "border-warning/30 bg-warning/10 text-warning",
  } satisfies Record<TerminalStatus, string>;
  const label = {
    active: "Aktiv",
    inactive: "Inaktiv",
    maintenance: "Vedlikehold",
  } satisfies Record<TerminalStatus, string>;

  return (
    <Badge variant="outline" className={cn("hover:bg-inherit", config[status])}>
      {label[status]}
    </Badge>
  );
}

function TerminalTableSkeleton() {
  return (
    <div className="rounded-lg border bg-card shadow-card">
      <div className="space-y-3 p-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

async function fetchTerminals(activeEntityId: string): Promise<Terminal[]> {
  const { data, error } = await supabase
    .from("pos_terminals")
    .select(
      "id, terminal_code, display_name, receipt_prefix, status, next_receipt_number, next_session_number, next_z_number, outlet_id, default_price_list_id, updated_at, outlet:pickup_locations!pos_terminals_outlet_id_fkey(display_name, pos_display_name), price_list:price_lists!pos_terminals_default_price_list_id_fkey(display_name)",
    )
    .eq("legal_entity_id", activeEntityId)
    .order("terminal_code", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Terminal[];
}

async function fetchPickupLocations(activeEntityId: string): Promise<PickupLocationOption[]> {
  const { data, error } = await supabase
    .from("pickup_locations")
    .select("id, display_name, pos_display_name")
    .eq("legal_entity_id", activeEntityId)
    .eq("has_pos", true)
    .eq("status", "active")
    .order("display_name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as PickupLocationOption[];
}

async function fetchPriceLists(activeEntityId: string): Promise<PriceListOption[]> {
  const { data, error } = await supabase
    .from("price_lists")
    .select("id, display_name, is_default")
    .eq("legal_entity_id", activeEntityId)
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("display_name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as PriceListOption[];
}

interface TerminalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  terminal: Terminal | null;
  activeEntityId: string;
  pickupLocations: PickupLocationOption[];
  priceLists: PriceListOption[];
}

function TerminalDialog({
  open,
  onOpenChange,
  terminal,
  activeEntityId,
  pickupLocations,
  priceLists,
}: TerminalDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = !!terminal;
  const form = useForm<TerminalFormValues>({
    resolver: zodResolver(terminalSchema),
    defaultValues: {
      terminal_code: "",
      display_name: "",
      outlet_id: "",
      default_price_list_id: NO_PRICE_LIST,
      receipt_prefix: "",
      status: "active",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      terminal_code: terminal?.terminal_code ?? "",
      display_name: terminal?.display_name ?? "",
      outlet_id: terminal?.outlet_id ?? "",
      default_price_list_id: terminal?.default_price_list_id ?? NO_PRICE_LIST,
      receipt_prefix: terminal?.receipt_prefix ?? "",
      status: terminal?.status ?? "active",
    });
  }, [form, open, terminal]);

  const saveMutation = useMutation({
    mutationFn: async (values: TerminalFormValues) => {
      const payload = {
        outlet_id: values.outlet_id,
        terminal_code: values.terminal_code.trim().toUpperCase(),
        display_name: values.display_name.trim(),
        default_price_list_id:
          values.default_price_list_id === NO_PRICE_LIST ? null : values.default_price_list_id,
        receipt_prefix: values.receipt_prefix.trim().toUpperCase(),
        status: values.status,
      };

      if (isEdit) {
        const { error } = await supabase
          .from("pos_terminals")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", terminal.id)
          .eq("legal_entity_id", activeEntityId);
        if (error) throw error;
        return;
      }

      const { error } = await supabase
        .from("pos_terminals")
        .insert({ ...payload, legal_entity_id: activeEntityId })
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_terminals", activeEntityId] });
      toast.success("Terminal lagret");
      onOpenChange(false);
    },
    onError: (error) => {
      const code = getSupabaseErrorCode(error);
      if (code === "23505") {
        form.setError("terminal_code", { message: "Kode finnes allerede for dette utsalget" });
        return;
      }
      if (code === "23503") {
        form.setError("root", {
          message: "Valgt utsalg/prisliste eksisterer ikke lenger — last siden på nytt",
        });
        return;
      }
      form.setError("root", { message: getSupabaseErrorMessage(error) });
    },
  });

  const hasNoOutlets = pickupLocations.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rediger terminal" : "Ny terminal"}</DialogTitle>
          <DialogDescription>
            Terminalen knyttes til aktivt utsalg og brukes av POS-klienter i butikk.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="space-y-5">
            {form.formState.errors.root?.message && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}

            {hasNoOutlets && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Ingen aktive POS-utsalg</AlertTitle>
                <AlertDescription>
                  Opprett eller aktiver et pickup_location med POS i NBHub før terminalen kan lagres.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="terminal_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Terminal-kode</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={20} autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="display_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Visningsnavn</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={100} autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="outlet_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Utsalg</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={hasNoOutlets}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Velg utsalg" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {pickupLocations.map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          {formatOutletName(location)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="default_price_list_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prisliste (standard)</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_PRICE_LIST}>Ingen (bruk utsalgets default)</SelectItem>
                      {priceLists.map((priceList) => (
                        <SelectItem key={priceList.id} value={priceList.id}>
                          {priceList.display_name}
                          {priceList.is_default ? " · standard" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="receipt_prefix"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kvittering-prefiks</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={10} autoComplete="off" />
                    </FormControl>
                    <FormDescription>
                      F.eks. “NB-01-”. Vises foran kvittering-nummer: NB-01-000042
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Aktiv</SelectItem>
                        <SelectItem value="inactive">Inaktiv</SelectItem>
                        <SelectItem value="maintenance">Vedlikehold</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {terminal && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  Nummersekvenser
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Disse oppdateres automatisk av systemet. Kontakt plattform-ansvarlig hvis de må nullstilles.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <dl className="grid gap-2 text-sm md:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Neste kvittering-nr</dt>
                    <dd className="font-mono font-medium">{terminal.next_receipt_number}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Neste sesjon-nr</dt>
                    <dd className="font-mono font-medium">{terminal.next_session_number}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Neste Z-rapport-nr</dt>
                    <dd className="font-mono font-medium">{terminal.next_z_number}</dd>
                  </div>
                </dl>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Avbryt
              </Button>
              <Button type="submit" disabled={saveMutation.isPending || hasNoOutlets}>
                {saveMutation.isPending ? "Lagrer…" : "Lagre terminal"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Terminaler() {
  const { activeEntity, activeEntityId, isLoading: isEntityLoading, hasNoAccess } = useLegalEntity();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTerminal, setSelectedTerminal] = useState<Terminal | null>(null);
  const [pendingStatus, setPendingStatus] = useState<{
    terminal: Terminal;
    status: TerminalStatus;
  } | null>(null);

  const terminalsQuery = useQuery({
    queryKey: ["pos_terminals", activeEntityId],
    queryFn: () => fetchTerminals(activeEntityId!),
    enabled: !!activeEntityId,
    staleTime: 60 * 1000,
  });

  const pickupLocationsQuery = useQuery({
    queryKey: ["pos_terminal_pickup_locations", activeEntityId],
    queryFn: () => fetchPickupLocations(activeEntityId!),
    enabled: !!activeEntityId,
    staleTime: 5 * 60 * 1000,
  });

  const priceListsQuery = useQuery({
    queryKey: ["pos_terminal_price_lists", activeEntityId],
    queryFn: () => fetchPriceLists(activeEntityId!),
    enabled: !!activeEntityId,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    setDialogOpen(false);
    setSelectedTerminal(null);
    setPendingStatus(null);
  }, [activeEntityId]);

  const statusMutation = useMutation({
    mutationFn: async ({ terminal, status }: { terminal: Terminal; status: TerminalStatus }) => {
      const { error } = await supabase
        .from("pos_terminals")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", terminal.id)
        .eq("legal_entity_id", activeEntityId!);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_terminals", activeEntityId] });
      toast.success("Terminalstatus oppdatert");
      setPendingStatus(null);
    },
    onError: (error) => {
      toast.error(getSupabaseErrorMessage(error));
      setPendingStatus(null);
    },
  });

  const terminals = terminalsQuery.data ?? [];
  const isLoading = isEntityLoading || terminalsQuery.isLoading;
  const subTitle = activeEntity
    ? `${activeEntity.short_code} — ${activeEntity.legal_name}`
    : "Velg aktivt utsalg";

  const terminalById = useMemo(
    () => new Map(terminals.map((terminal) => [terminal.id, terminal])),
    [terminals],
  );

  useEffect(() => {
    if (selectedTerminal && !terminalById.has(selectedTerminal.id)) {
      setDialogOpen(false);
      setSelectedTerminal(null);
    }
  }, [selectedTerminal, terminalById]);

  const openCreateDialog = () => {
    setSelectedTerminal(null);
    setDialogOpen(true);
  };

  const openEditDialog = (terminal: Terminal) => {
    setSelectedTerminal(terminal);
    setDialogOpen(true);
  };

  const requestStatusChange = (terminal: Terminal, status: TerminalStatus) => {
    if (terminal.status === status) return;
    if (terminal.status === "active" && status !== "active") {
      setPendingStatus({ terminal, status });
      return;
    }
    statusMutation.mutate({ terminal, status });
  };

  if (hasNoAccess) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Ingen POS-tilgang</AlertTitle>
        <AlertDescription>Kontakt administrator for tilgang til et utsalg.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Terminaler</h1>
          <p className="text-sm text-muted-foreground">{subTitle}</p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2" disabled={!activeEntityId}>
          <Plus className="h-4 w-4" />
          Ny terminal
        </Button>
      </div>

      {isLoading && <TerminalTableSkeleton />}

      {terminalsQuery.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Kunne ikke hente terminaler</AlertTitle>
          <AlertDescription>{getSupabaseErrorMessage(terminalsQuery.error)}</AlertDescription>
        </Alert>
      )}

      {!isLoading && !terminalsQuery.isError && terminals.length === 0 && activeEntity && (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-lg border bg-card p-8 text-center shadow-card">
          <div>
            <p className="text-sm font-medium text-foreground">Ingen terminaler for {activeEntity.short_code}.</p>
            <p className="text-xs text-muted-foreground">
              Opprett første terminal med “+ Ny terminal”.
            </p>
          </div>
          <Button onClick={openCreateDialog} className="gap-2">
            <Plus className="h-4 w-4" />
            Ny terminal
          </Button>
        </div>
      )}

      {!isLoading && !terminalsQuery.isError && terminals.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Navn</TableHead>
                <TableHead>Utsalg</TableHead>
                <TableHead>Prisliste</TableHead>
                <TableHead>Kvittering-prefiks</TableHead>
                <TableHead>Neste kvittering</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[120px] text-right">Handling</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terminals.map((terminal) => (
                <TableRow key={terminal.id} className="hover:bg-transparent">
                  <TableCell className="font-mono font-medium">{terminal.terminal_code}</TableCell>
                  <TableCell className="font-medium">{terminal.display_name}</TableCell>
                  <TableCell>{formatOutletName(terminal.outlet)}</TableCell>
                  <TableCell>{terminal.price_list?.display_name ?? "—"}</TableCell>
                  <TableCell className="font-mono">{terminal.receipt_prefix}</TableCell>
                  <TableCell className="font-mono">{terminal.next_receipt_number}</TableCell>
                  <TableCell>
                    <StatusBadge status={terminal.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog(terminal)}>
                        <PenLine className="h-4 w-4" />
                        Rediger
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Statusvalg">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={terminal.status === "active"}
                            onClick={() => requestStatusChange(terminal, "active")}
                          >
                            Sett som Aktiv
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={terminal.status === "inactive"}
                            onClick={() => requestStatusChange(terminal, "inactive")}
                          >
                            Sett som Inaktiv
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={terminal.status === "maintenance"}
                            onClick={() => requestStatusChange(terminal, "maintenance")}
                          >
                            Sett som Vedlikehold
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {activeEntityId && (
        <TerminalDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          terminal={selectedTerminal}
          activeEntityId={activeEntityId}
          pickupLocations={pickupLocationsQuery.data ?? []}
          priceLists={priceListsQuery.data ?? []}
        />
      )}

      <AlertDialog open={!!pendingStatus} onOpenChange={(open) => !open && setPendingStatus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Endre status på aktiv terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              Dette setter “{pendingStatus?.terminal.display_name}” til en ikke-aktiv status. Pågående drift kan påvirkes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingStatus && statusMutation.mutate(pendingStatus)}
              disabled={statusMutation.isPending}
            >
              Bekreft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}