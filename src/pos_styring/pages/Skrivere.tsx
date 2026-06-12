// POS Styring → Skrivere: register over fysiske skrivere. Test-knappen
// legger en jobb i pos_print_jobs ({job_type:'test'}); en ekstern Node-poller
// plukker den opp og snakker med skriveren over LAN (mixed-content fra
// nettleser hindrer direkte fetch). Kø-status under viser nyeste jobber.
//
// DEAD CODE: src/pos_styring/lib/eposPrint.ts brukes ikke lenger. Slettes
// når polleren er bekreftet i produksjon.

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, MoreHorizontal, Plus, Printer, Wifi, XCircle } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";
import { supabase } from "@/integrations/supabase/client";

type PaperWidth = "80mm" | "58mm";
type Protocol = "http" | "https";
type JobStatus = "queued" | "printing" | "done" | "failed";

interface Printer {
  id: string;
  legal_entity_id: string;
  display_name: string;
  ip: string;
  port: number;
  protocol: Protocol;
  paper_width: PaperWidth;
  brand: string;
  device_id: string;
  enabled: boolean;
}

interface PrintJob {
  id: string;
  printer_id: string;
  job_type: string;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  printed_at: string | null;
}

const printerSchema = z.object({
  display_name: z.string().trim().min(1, "Påkrevd").max(80),
  ip: z
    .string()
    .trim()
    .min(1, "Påkrevd")
    .regex(/^[a-zA-Z0-9.\-:]+$/, "Bare IP eller vertsnavn"),
  port: z.coerce.number().int().min(1).max(65535),
  protocol: z.enum(["http", "https"]),
  paper_width: z.enum(["80mm", "58mm"]),
  device_id: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
});

type PrinterForm = z.infer<typeof printerSchema>;

const defaultForm: PrinterForm = {
  display_name: "",
  ip: "",
  port: 80,
  protocol: "http",
  paper_width: "80mm",
  device_id: "local_printer",
  enabled: true,
};

async function fetchPrinters(activeEntityId: string): Promise<Printer[]> {
  const { data, error } = await supabase
    .from("pos_printers")
    .select("id, legal_entity_id, display_name, ip, port, protocol, paper_width, brand, device_id, enabled")
    .eq("legal_entity_id", activeEntityId)
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Printer[];
}

async function fetchRecentJobs(printerIds: string[]): Promise<PrintJob[]> {
  if (printerIds.length === 0) return [];
  const { data, error } = await supabase
    .from("pos_print_jobs")
    .select("id, printer_id, job_type, status, attempts, last_error, created_at, printed_at")
    .in("printer_id", printerIds)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as PrintJob[];
}

function StatusPill({ status }: { status: JobStatus }) {
  if (status === "done") {
    return (
      <Badge variant="default" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> done
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> failed
      </Badge>
    );
  }
  if (status === "printing") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" /> printing
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" /> queued
    </Badge>
  );
}

export default function Skrivere() {
  const { activeEntityId, activeEntity } = useLegalEntity();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Printer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Printer | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data: printers = [], isLoading } = useQuery({
    queryKey: ["pos_printers", activeEntityId],
    queryFn: () => fetchPrinters(activeEntityId!),
    enabled: !!activeEntityId,
  });

  const printerIds = useMemo(() => printers.map((p) => p.id), [printers]);

  const jobsQuery = useQuery({
    queryKey: ["pos_print_jobs_recent", printerIds.join(",")],
    queryFn: () => fetchRecentJobs(printerIds),
    enabled: printerIds.length > 0,
    refetchInterval: 5000,
  });

  const form = useForm<PrinterForm>({
    resolver: zodResolver(printerSchema),
    defaultValues: defaultForm,
  });

  const openCreate = () => {
    setEditing(null);
    form.reset(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (p: Printer) => {
    setEditing(p);
    form.reset({
      display_name: p.display_name,
      ip: p.ip,
      port: p.port,
      protocol: p.protocol,
      paper_width: p.paper_width,
      device_id: p.device_id,
      enabled: p.enabled,
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: PrinterForm) => {
      if (editing) {
        const { error } = await supabase
          .from("pos_printers")
          .update({
            display_name: values.display_name.trim(),
            ip: values.ip.trim(),
            port: values.port,
            protocol: values.protocol,
            paper_width: values.paper_width,
            device_id: values.device_id.trim(),
            enabled: values.enabled,
          })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        if (!activeEntityId) throw new Error("Mangler aktiv enhet");
        const { error } = await supabase.from("pos_printers").insert({
          legal_entity_id: activeEntityId,
          display_name: values.display_name.trim(),
          ip: values.ip.trim(),
          port: values.port,
          protocol: values.protocol,
          paper_width: values.paper_width,
          device_id: values.device_id.trim(),
          enabled: values.enabled,
        });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_printers", activeEntityId] });
      toast.success(editing ? "Skriver oppdatert" : "Skriver opprettet");
      setDialogOpen(false);
    },
    onError: (e) => toast.error("Kunne ikke lagre", { description: e instanceof Error ? e.message : "Ukjent feil" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pos_printers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_printers", activeEntityId] });
      toast.success("Skriver slettet");
      setDeleteTarget(null);
    },
    onError: (e) => toast.error("Kunne ikke slette", { description: e instanceof Error ? e.message : "Ukjent feil" }),
  });

  const handleTest = async (p: Printer) => {
    setTestingId(p.id);
    try {
      const { error } = await supabase.from("pos_print_jobs").insert({
        printer_id: p.id,
        job_type: "test",
        payload: {
          kind: "test",
          message: "NBOS testutskrift",
          requested_at: new Date().toISOString(),
        },
      });
      if (error) throw error;
      toast.success("Test-jobb lagt i kø", {
        description: "Polleren plukker den opp og skriver ut. Se kø-status under.",
      });
      await queryClient.invalidateQueries({ queryKey: ["pos_print_jobs_recent", printerIds.join(",")] });
    } catch (e) {
      toast.error("Kunne ikke legge i kø", {
        description: e instanceof Error ? e.message : "Ukjent feil",
      });
    } finally {
      setTestingId(null);
    }
  };

  const printerById = useMemo(() => new Map(printers.map((p) => [p.id, p])), [printers]);
  const jobs = jobsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">Skrivere</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeEntity ? `${activeEntity.short_code} — ${activeEntity.legal_name}` : "Velg aktiv enhet"} ·
            Fysiske kvitterings-/bong-skrivere. Test og salg går via jobb-kø — en ekstern poller skriver ut.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Ny skriver
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : printers.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <Printer className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Ingen skrivere registrert</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Legg til Epson TM/ePOS-Print-skriveren med IP-adressen på LAN. Senere kobler dere kassene til skriveren
            (kvittering + evt. bong-stasjon).
          </p>
          <Button onClick={openCreate} className="mt-2">
            <Plus className="h-4 w-4" /> Ny skriver
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Navn</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead>Papir</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-44 text-right">Handling</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {printers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.display_name}
                    <div className="text-xs text-muted-foreground">{p.brand} · device_id «{p.device_id}»</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.protocol}://{p.ip}:{p.port}
                  </TableCell>
                  <TableCell>{p.paper_width}</TableCell>
                  <TableCell>
                    <Badge variant={p.enabled ? "default" : "secondary"}>
                      {p.enabled ? "Aktiv" : "Av"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={testingId === p.id || !p.enabled}
                        onClick={() => handleTest(p)}
                      >
                        <Wifi className="h-4 w-4" />
                        {testingId === p.id ? "Legger i kø…" : "Test"}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(p)}>Rediger</DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(p)}
                          >
                            Slett
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

      {printers.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Kø-status (siste 20 jobber)
            </h2>
            <p className="text-xs text-muted-foreground">Oppdateres automatisk hvert 5. sek</p>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tid</TableHead>
                  <TableHead>Skriver</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Forsøk</TableHead>
                  <TableHead>Feil</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                      Ingen jobber ennå. Test en skriver for å se kø-status.
                    </TableCell>
                  </TableRow>
                ) : (
                  jobs.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="font-mono text-xs">
                        {new Date(j.created_at).toLocaleTimeString("nb-NO")}
                      </TableCell>
                      <TableCell>{printerById.get(j.printer_id)?.display_name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{j.job_type}</TableCell>
                      <TableCell>
                        <StatusPill status={j.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{j.attempts}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs text-destructive">
                        {j.last_error ?? ""}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Ekstern poller må kjøre</AlertTitle>
            <AlertDescription>
              Test-jobben blir hengende på «queued» til Node-polleren plukker den opp. Hvis status ikke endrer
              seg, sjekk at polleren er oppe og kobler til Supabase med service-role.
            </AlertDescription>
          </Alert>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Rediger skriver" : "Ny skriver"}</DialogTitle>
            <DialogDescription>Epson TM-T20III eller annen ePOS-Print-kompatibel skriver på LAN.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="display_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Visningsnavn</FormLabel>
                  <FormControl><Input {...field} placeholder="Kvittering Kasse 1" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-[1fr_120px_120px] gap-3">
                <FormField control={form.control} name="ip" render={({ field }) => (
                  <FormItem>
                    <FormLabel>IP / vertsnavn</FormLabel>
                    <FormControl><Input {...field} placeholder="192.168.1.45" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="port" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl><Input type="number" min={1} max={65535} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="protocol" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Protokoll</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="http">http</SelectItem>
                        <SelectItem value="https">https</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="paper_width" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Papirbredde</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="80mm">80 mm</SelectItem>
                        <SelectItem value="58mm">58 mm</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="device_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>device_id</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormDescription className="text-xs">Standard er «local_printer» for Epson TM.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="enabled" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel>Aktiv</FormLabel>
                    <FormDescription className="text-xs">Hvis av: brukes ikke ved salg eller test.</FormDescription>
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
              Skriveren fjernes fra registeret. Terminal-mappinger til denne skriveren blir også fjernet.
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
