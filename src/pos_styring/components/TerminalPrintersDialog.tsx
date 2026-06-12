// POS Styring → Terminaler → "Skrivere": map en terminal til
// (a) én kvittering-skriver (role='receipt', station_id NULL), og
// (b) 0..n bong-skrivere per stasjon (role='station', station_id NOT NULL).
// CHECK-regelen håndheves i DB; UI-en speiler den ved å ikke tillate
// stasjons-skrivere uten valgt stasjon, og å ha receipt som egen seksjon.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const NONE = "__none__";

interface Printer {
  id: string;
  display_name: string;
  enabled: boolean;
}
interface Station {
  id: string;
  display_name: string;
  is_active: boolean;
}
interface Mapping {
  id: string;
  printer_id: string;
  role: "receipt" | "station";
  station_id: string | null;
}

interface Props {
  terminalId: string | null;
  terminalName?: string;
  activeEntityId: string;
  onOpenChange: (open: boolean) => void;
}

export function TerminalPrintersDialog({ terminalId, terminalName, activeEntityId, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const open = !!terminalId;

  const printersQuery = useQuery({
    queryKey: ["pos_printers_for_mapping", activeEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_printers")
        .select("id, display_name, enabled")
        .eq("legal_entity_id", activeEntityId)
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as Printer[];
    },
    enabled: open,
  });

  const stationsQuery = useQuery({
    queryKey: ["pos_print_stations_for_mapping", activeEntityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_print_stations")
        .select("id, display_name, is_active")
        .eq("legal_entity_id", activeEntityId)
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as Station[];
    },
    enabled: open,
  });

  const mappingsQuery = useQuery({
    queryKey: ["pos_terminal_printers", terminalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_terminal_printers")
        .select("id, printer_id, role, station_id")
        .eq("terminal_id", terminalId!);
      if (error) throw error;
      return (data ?? []) as Mapping[];
    },
    enabled: open,
  });

  const [receiptPrinterId, setReceiptPrinterId] = useState<string>(NONE);
  // station_id -> printer_id (or NONE)
  const [stationMap, setStationMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!mappingsQuery.data) return;
    const receipt = mappingsQuery.data.find((m) => m.role === "receipt");
    setReceiptPrinterId(receipt?.printer_id ?? NONE);
    const sm: Record<string, string> = {};
    for (const m of mappingsQuery.data) {
      if (m.role === "station" && m.station_id) sm[m.station_id] = m.printer_id;
    }
    setStationMap(sm);
  }, [mappingsQuery.data]);

  const printers = printersQuery.data ?? [];
  const stations = stationsQuery.data ?? [];

  const enabledPrinters = useMemo(() => printers.filter((p) => p.enabled), [printers]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!terminalId) return;
      // Strategi: slett alle eksisterende mappinger for denne terminalen og
      // sett inn nye i en operasjon. Tabellen er liten (typisk <10 rader/term)
      // og dette unngår å måtte diffe rolle/station per rad.
      const { error: delErr } = await supabase
        .from("pos_terminal_printers")
        .delete()
        .eq("terminal_id", terminalId);
      if (delErr) throw delErr;

      const rows: Array<{
        terminal_id: string;
        printer_id: string;
        role: "receipt" | "station";
        station_id: string | null;
      }> = [];

      if (receiptPrinterId !== NONE) {
        rows.push({
          terminal_id: terminalId,
          printer_id: receiptPrinterId,
          role: "receipt",
          station_id: null,
        });
      }
      for (const [station_id, printer_id] of Object.entries(stationMap)) {
        if (printer_id && printer_id !== NONE) {
          rows.push({ terminal_id: terminalId, printer_id, role: "station", station_id });
        }
      }
      if (rows.length === 0) return;
      const { error: insErr } = await supabase.from("pos_terminal_printers").insert(rows);
      if (insErr) throw insErr;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_terminal_printers", terminalId] });
      toast.success("Skriver-mapping lagret");
      onOpenChange(false);
    },
    onError: (e) =>
      toast.error("Kunne ikke lagre mapping", {
        description: e instanceof Error ? e.message : "Ukjent feil",
      }),
  });

  const isLoading =
    printersQuery.isLoading || stationsQuery.isLoading || mappingsQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Skrivere — {terminalName ?? ""}</DialogTitle>
          <DialogDescription>
            Velg én kvittering-skriver og 0..n bong-skrivere per stasjon. Flere terminaler kan dele
            samme skriver.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : printers.length === 0 ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Ingen skrivere registrert</AlertTitle>
            <AlertDescription>
              Opprett skrivere under «Skrivere» først.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="text-sm font-medium">Kvittering-skriver</div>
              <Select value={receiptPrinterId} onValueChange={setReceiptPrinterId}>
                <SelectTrigger>
                  <SelectValue placeholder="Velg skriver" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Ingen — ikke skriv ut kvittering</SelectItem>
                  {enabledPrinters.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Brukes for full kvittering ved hvert salg (role=receipt).
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Bong-skrivere per stasjon</div>
              {stations.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Ingen stasjoner registrert. Opprett under «Stasjoner» hvis dere skal skrive ut
                  bonger.
                </p>
              ) : (
                <div className="space-y-2">
                  {stations.map((s) => {
                    const current = stationMap[s.id] ?? NONE;
                    return (
                      <div key={s.id} className="grid grid-cols-[1fr_2fr] items-center gap-3">
                        <div className="text-sm">{s.display_name}</div>
                        <Select
                          value={current}
                          onValueChange={(v) =>
                            setStationMap((prev) => {
                              const next = { ...prev };
                              if (v === NONE) delete next[s.id];
                              else next[s.id] = v;
                              return next;
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Ingen skriver" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Ingen</SelectItem>
                            {enabledPrinters.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.display_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || isLoading}>
            {saveMutation.isPending ? "Lagrer…" : "Lagre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
