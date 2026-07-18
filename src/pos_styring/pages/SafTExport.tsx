import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  AlertCircle,
  ArchiveRestore,
  CheckCircle2,
  Download,
  FileWarning,
  Info,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { supabase } from "@/integrations/supabase/client";
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";

// ─── Types ────────────────────────────────────────────────────────────────
interface TerminalOption {
  id: string;
  terminal_code: string;
  display_name: string;
}

interface SafTExportRow {
  id: string;
  period_start: string;
  period_end: string;
  file_name: string;
  storage_path: string | null;
  sha256: string | null;
  file_size_bytes: number | null;
  status: "pending" | "ready" | "failed";
  event_count: number;
  transaction_count: number;
  validation_errors: string[];
  error_message: string | null;
  created_at: string;
  terminal_id: string | null;
  terminal_code: string | null;
}

interface EdgeResult {
  export_id: string;
  file_name: string;
  storage_path: string;
  sha256: string;
  file_size_bytes: number;
  event_count: number;
  transaction_count: number;
  signed_url: string | null;
}

// ─── Data ─────────────────────────────────────────────────────────────────
async function fetchTerminals(entityId: string): Promise<TerminalOption[]> {
  const { data, error } = await supabase
    .from("pos_terminals")
    .select("id, terminal_code, display_name")
    .eq("legal_entity_id", entityId)
    .order("terminal_code");
  if (error) throw error;
  return (data ?? []) as TerminalOption[];
}

async function fetchExports(entityId: string): Promise<SafTExportRow[]> {
  const { data, error } = await supabase
    .from("pos_saf_t_exports")
    .select(
      "id, period_start, period_end, file_name, storage_path, sha256, file_size_bytes, status, event_count, transaction_count, validation_errors, error_message, created_at, terminal_id, terminal:pos_terminals(terminal_code)",
    )
    .eq("legal_entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    period_start: r.period_start,
    period_end: r.period_end,
    file_name: r.file_name,
    storage_path: r.storage_path,
    sha256: r.sha256,
    file_size_bytes: r.file_size_bytes,
    status: r.status,
    event_count: r.event_count,
    transaction_count: r.transaction_count,
    validation_errors: (r.validation_errors ?? []) as string[],
    error_message: r.error_message,
    created_at: r.created_at,
    terminal_id: r.terminal_id,
    terminal_code: r.terminal?.terminal_code ?? null,
  }));
}

// ─── Utils ────────────────────────────────────────────────────────────────
function defaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
}

function fmtBytes(n: number | null) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function downloadExisting(row: SafTExportRow) {
  if (!row.storage_path) {
    toast.error("Ingen fil lagret for denne eksporten");
    return;
  }
  const { data, error } = await supabase.storage
    .from("pos-saf-t-exports")
    .createSignedUrl(row.storage_path, 60 * 5);
  if (error || !data?.signedUrl) {
    toast.error(error?.message ?? "Kunne ikke lage nedlastingslenke");
    return;
  }
  triggerDownload(data.signedUrl, row.file_name);
}

function StatusBadge({ status }: { status: SafTExportRow["status"] }) {
  if (status === "ready")
    return (
      <Badge variant="outline" className="border-success/30 bg-success/10 text-success gap-1">
        <CheckCircle2 className="h-3 w-3" /> Klar
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive gap-1">
        <FileWarning className="h-3 w-3" /> Feilet
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> Genererer
    </Badge>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────
export default function SafTExport() {
  const qc = useQueryClient();
  const { activeEntityId, activeEntity, isLoading: entityLoading, hasNoAccess } = useLegalEntity();
  const [{ from, to }, setDates] = useState(defaultDates);
  const [terminalId, setTerminalId] = useState<string>("all");
  const [lastResult, setLastResult] = useState<EdgeResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);

  const terminalsQuery = useQuery({
    queryKey: ["pos_terminals_saf_t", activeEntityId],
    queryFn: () => fetchTerminals(activeEntityId!),
    enabled: !!activeEntityId,
  });

  const exportsQuery = useQuery({
    queryKey: ["pos_saf_t_exports", activeEntityId],
    queryFn: () => fetchExports(activeEntityId!),
    enabled: !!activeEntityId,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      setValidationErrors(null);
      setLastResult(null);
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toIso = new Date(`${to}T23:59:59.999`).toISOString();
      const { data, error } = await supabase.functions.invoke<
        EdgeResult | { error: string; errors?: string[]; message?: string; export_id?: string }
      >("saf-t-cash-register-export", {
        body: {
          legal_entity_id: activeEntityId,
          terminal_id: terminalId === "all" ? null : terminalId,
          period_start: fromIso,
          period_end: toIso,
        },
      });
      if (error) throw error;
      if (data && "error" in data) {
        if (data.error === "validation_failed" && data.errors) {
          setValidationErrors(data.errors);
          throw new Error(`XML-validering feilet med ${data.errors.length} feil`);
        }
        throw new Error(data.message ?? data.error);
      }
      return data as EdgeResult;
    },
    onSuccess: (data) => {
      setLastResult(data);
      qc.invalidateQueries({ queryKey: ["pos_saf_t_exports"] });
      toast.success("SAF-T eksport klar");
      if (data.signed_url) {
        triggerDownload(data.signed_url, data.file_name);
      }
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: ["pos_saf_t_exports"] });
      toast.error(e.message);
    },
  });

  const canGenerate = useMemo(
    () => !!activeEntityId && !!from && !!to && from <= to && !generateMutation.isPending,
    [activeEntityId, from, to, generateMutation.isPending],
  );

  if (entityLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (hasNoAccess || !activeEntityId) {
    return (
      <div className="p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Du har ikke tilgang til POS Styring for noen selskap.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SAF-T Kassasystem</h1>
        <p className="text-sm text-muted-foreground">
          Elektronisk utlevering av kassejournal etter Skatteetatens SAF-T Cash Register
          {activeEntity ? ` · ${activeEntity.short_code}` : ""}
        </p>
      </div>

      <Alert>
        <ArchiveRestore className="h-4 w-4" />
        <AlertTitle>SAF-T er et utleveringsformat</AlertTitle>
        <AlertDescription className="text-sm">
          Hele den elektroniske journalen (kvitteringer, hendelser, X/Z-rapporter og hash-kjede) skal
          fortsatt oppbevares i sin helhet i hele oppbevaringstiden (jf. bokføringsloven §13). SAF-T
          XML er et eksportformat for utlevering til Skatteetaten på forespørsel — den erstatter ikke
          det underliggende journalarkivet.
        </AlertDescription>
      </Alert>

      <Card className="p-4 space-y-4">
        <h2 className="text-lg font-semibold">Ny eksport</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="sf-from" className="text-xs text-muted-foreground">
              Fra dato
            </Label>
            <Input
              id="sf-from"
              type="date"
              value={from}
              onChange={(e) => setDates((d) => ({ ...d, from: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sf-to" className="text-xs text-muted-foreground">
              Til dato
            </Label>
            <Input
              id="sf-to"
              type="date"
              value={to}
              onChange={(e) => setDates((d) => ({ ...d, to: e.target.value }))}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs text-muted-foreground">Terminal</Label>
            <Select value={terminalId} onValueChange={setTerminalId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle terminaler i selskapet</SelectItem>
                {(terminalsQuery.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.terminal_code} · {t.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button disabled={!canGenerate} onClick={() => generateMutation.mutate()}>
            {generateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Generer SAF-T XML
          </Button>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3" /> Validerer strukturelt mot Skatteetatens skjema før nedlasting
          </span>
        </div>

        {validationErrors && validationErrors.length > 0 && (
          <Alert variant="destructive">
            <FileWarning className="h-4 w-4" />
            <AlertTitle>Valideringsfeil ({validationErrors.length})</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5 mt-2 space-y-1 text-xs font-mono">
                {validationErrors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {validationErrors.length > 20 && (
                  <li>… og {validationErrors.length - 20} til</li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {lastResult && (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Eksport klar</AlertTitle>
            <AlertDescription className="text-sm space-y-1">
              <div>
                <span className="font-mono">{lastResult.file_name}</span> ·{" "}
                {fmtBytes(lastResult.file_size_bytes)}
              </div>
              <div>
                {lastResult.transaction_count} transaksjoner · {lastResult.event_count} hendelser
              </div>
              <div className="font-mono text-xs break-all">SHA-256: {lastResult.sha256}</div>
            </AlertDescription>
          </Alert>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Tidligere eksporter</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["pos_saf_t_exports"] })}
          >
            Oppdater
          </Button>
        </div>

        {exportsQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : exportsQuery.error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{(exportsQuery.error as Error).message}</AlertDescription>
          </Alert>
        ) : (exportsQuery.data ?? []).length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            Ingen SAF-T eksporter generert ennå.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Periode</TableHead>
                <TableHead>Terminal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Trans.</TableHead>
                <TableHead className="text-right">Hendelser</TableHead>
                <TableHead className="text-right">Størrelse</TableHead>
                <TableHead>Generert</TableHead>
                <TableHead className="text-right">Handling</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(exportsQuery.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">
                    {format(new Date(r.period_start), "yyyy-MM-dd")} →{" "}
                    {format(new Date(r.period_end), "yyyy-MM-dd")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.terminal_code ?? "Alle"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                    {r.status === "failed" && r.error_message && (
                      <div className="text-xs text-destructive mt-1">{r.error_message}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.transaction_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.event_count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtBytes(r.file_size_bytes)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={r.status !== "ready" || !r.storage_path}
                      onClick={() => downloadExisting(r)}
                    >
                      <Download className="h-4 w-4" /> Last ned
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
