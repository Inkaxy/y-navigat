// POS Styring → Skrivere: register over fysiske kvitterings-/bong-skrivere
// (Epson TM/ePOS-Print) som kan deles på tvers av kasser. Per skriver kan man
// kjøre en test-utskrift som POSTer rå ePOS-XML direkte til skriverens IP fra
// nettleseren. Mixed-content (https → http) gir tydelig forklaring.

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, MoreHorizontal, Plus, Printer, Wifi } from "lucide-react";
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
import { buildTestXml, detectMixedContent, eposPrint, type EposPrintResult } from "@/pos_styring/lib/eposPrint";

type PaperWidth = "80mm" | "58mm";
type Protocol = "http" | "https";

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

function formatResult(r: EposPrintResult): { variant: "success" | "warning" | "error"; title: string; description: string } {
  switch (r.kind) {
    case "ok":
      return { variant: "success", title: "Skriver svarte OK", description: "Sjekk skriveren — testutskriften skal komme ut." };
    case "printer_error":
      return {
        variant: "error",
        title: "Skriver-feil",
        description: `Skriveren tok imot men rapporterte feil (success=${r.success ?? "?"}, code=${r.code ?? "?"}, status=${r.status ?? "?"}).`,
      };
    case "http_error":
      return {
        variant: "error",
        title: `HTTP ${r.status}`,
        description: `Skriveren svarte med ${r.status} ${r.statusText}. Sjekk device_id ("local_printer") og at ePOS-Print-tjenesten er på.`,
      };
    case "mixed_content":
      return {
        variant: "warning",
        title: "Blokkert av mixed-content",
        description:
          `Siden er på ${r.pageProtocol.toUpperCase()}, men skriveren er på ${r.printerProtocol.toUpperCase()}. Nettleseren stopper requesten før den når skriveren. Løsninger: skru på HTTPS på skriveren (krever sertifikat), kjør kiosken via HTTP-domene, eller bruk en print-bro på LAN.`,
      };
    case "network_error":
      return {
        variant: "error",
        title: "Nettverksfeil",
        description: `${r.message}. Vanlige årsaker: feil IP, skriver av, ikke samme nettverk, eller CORS/mixed-content (sjekk DevTools → Console).`,
      };
  }
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

  const pageProtocol = typeof window !== "undefined" ? window.location.protocol.replace(":", "") : "http";

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
      const result = await eposPrint(
        { ip: p.ip, port: p.port, protocol: p.protocol, device_id: p.device_id },
        buildTestXml(),
      );
      const info = formatResult(result);
      if (info.variant === "success") toast.success(info.title, { description: info.description });
      else if (info.variant === "warning") toast.warning(info.title, { description: info.description, duration: 10000 });
      else toast.error(info.title, { description: info.description, duration: 10000 });
    } finally {
      setTestingId(null);
    }
  };

  const httpsOnHttpsWarning = useMemo(() => {
    return pageProtocol === "https" && printers.some((p) => p.protocol === "http");
  }, [pageProtocol, printers]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">Skrivere</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeEntity ? `${activeEntity.short_code} — ${activeEntity.legal_name}` : "Velg aktiv enhet"} ·
            Fysiske kvitterings-/bong-skrivere som kan deles på tvers av kasser.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Ny skriver
        </Button>
      </div>

      {httpsOnHttpsWarning && (
        <Alert variant="default" className="border-amber-500/40 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle>Mixed content kan blokkere utskrift</AlertTitle>
          <AlertDescription>
            Denne siden kjører på HTTPS, og minst én skriver er konfigurert med HTTP. Nettleseren blokkerer da
            test-utskriften før den når skriveren. Bruk «Test»-knappen for å bekrefte før dere går videre.
          </AlertDescription>
        </Alert>
      )}

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
              {printers.map((p) => {
                const mc = detectMixedContent({ ip: p.ip, port: p.port, protocol: p.protocol, device_id: p.device_id });
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {p.display_name}
                      <div className="text-xs text-muted-foreground">{p.brand} · device_id «{p.device_id}»</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>{p.protocol}://{p.ip}:{p.port}</div>
                      {mc.blocked && (
                        <div className="mt-0.5 inline-flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> mixed-content
                        </div>
                      )}
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
                          {testingId === p.id ? "Tester…" : "Test"}
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
                );
              })}
            </TableBody>
          </Table>
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
              Skriveren fjernes fra registeret. Kommer du til å koble den til kasser senere må du opprette den på nytt.
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
