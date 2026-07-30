import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { AlertCircle, KeyRound, MoreHorizontal, PenLine, Plus, Search, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type OperatorStatus = "active" | "inactive";

interface Operator {
  id: string;
  legal_entity_id: string;
  operator_code: string;
  display_name: string;
  status: OperatorStatus;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  terminal_count: number;
}

interface TerminalOption {
  id: string;
  terminal_code: string;
  display_name: string;
  status: string;
}

const PIN_REGEX = /^\d{4,6}$/;
const OPERATOR_CODE_REGEX = /^[A-Z0-9]{2,8}$/;

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

function StatusBadge({ status }: { status: OperatorStatus }) {
  const config = {
    active: "border-success/30 bg-success/10 text-success",
    inactive: "border-muted bg-muted text-muted-foreground",
  } satisfies Record<OperatorStatus, string>;
  const label = { active: "Aktiv", inactive: "Inaktiv" } satisfies Record<OperatorStatus, string>;
  return (
    <Badge variant="outline" className={cn("hover:bg-inherit", config[status])}>
      {label[status]}
    </Badge>
  );
}

function OperatorTableSkeleton() {
  return (
    <div className="rounded-lg border bg-card shadow-card">
      <div className="space-y-3 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

async function fetchOperators(activeEntityId: string): Promise<Operator[]> {
  const { data, error } = await supabase
    .from("pos_operators")
    .select(
      "id, legal_entity_id, operator_code, display_name, status, last_login_at, created_at, updated_at, pos_operator_terminals(terminal_id)",
    )
    .eq("legal_entity_id", activeEntityId)
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    legal_entity_id: row.legal_entity_id,
    operator_code: row.operator_code,
    display_name: row.display_name,
    status: row.status,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    terminal_count: Array.isArray(row.pos_operator_terminals) ? row.pos_operator_terminals.length : 0,
  }));
}

async function fetchTerminalsForEntity(activeEntityId: string): Promise<TerminalOption[]> {
  const { data, error } = await supabase
    .from("pos_terminals")
    .select("id, terminal_code, display_name, status")
    .eq("legal_entity_id", activeEntityId)
    .order("terminal_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TerminalOption[];
}

// ──────────────────────────────────────────────────────────────────────────
// Opprett-dialog (samlet med PIN via pos_create_operator-RPC)
// ──────────────────────────────────────────────────────────────────────────

const createSchema = z
  .object({
    display_name: z.string().trim().min(2, "Minst 2 tegn").max(100, "Maks 100 tegn"),
    operator_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(OPERATOR_CODE_REGEX, "2–8 tegn, kun A–Z og 0–9"),
    pin: z.string().regex(PIN_REGEX, "PIN må være 4–6 siffer"),
    confirm_pin: z.string(),
  })
  .refine((v) => v.pin === v.confirm_pin, {
    path: ["confirm_pin"],
    message: "PIN stemmer ikke",
  });

type CreateValues = z.infer<typeof createSchema>;

function CreateOperatorDialog({
  open,
  onOpenChange,
  activeEntityId,
  existingCodes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeEntityId: string;
  existingCodes: Set<string>;
}) {
  const queryClient = useQueryClient();
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { display_name: "", operator_code: "", pin: "", confirm_pin: "" },
  });

  useEffect(() => {
    if (open) form.reset({ display_name: "", operator_code: "", pin: "", confirm_pin: "" });
    // Sikkerhet: ikke behold PIN i state mellom åpninger
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: async (values: CreateValues) => {
      const code = values.operator_code.trim().toUpperCase();
      if (existingCodes.has(code)) {
        throw { code: "23505", message: "Kode finnes allerede" };
      }
      const { error } = await supabase.rpc("pos_create_operator", {
        p_legal_entity_id: activeEntityId,
        p_operator_code: code,
        p_display_name: values.display_name.trim(),
        p_pin: values.pin,
        p_user_id: undefined,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_operators", activeEntityId] });
      toast.success("Operatør opprettet");
      form.reset({ display_name: "", operator_code: "", pin: "", confirm_pin: "" });
      onOpenChange(false);
    },
    onError: (error) => {
      const code = getSupabaseErrorCode(error);
      if (code === "23505") {
        form.setError("operator_code", { message: "Kode finnes allerede for dette selskapet" });
        return;
      }
      // Aldri inkluder PIN i feilmelding
      form.setError("root", { message: getSupabaseErrorMessage(error) });
    },
  });

  const onSubmit = (values: CreateValues) => {
    // Soft-validering før submit
    const code = values.operator_code.trim().toUpperCase();
    if (existingCodes.has(code)) {
      form.setError("operator_code", { message: "Kode finnes allerede for dette selskapet" });
      return;
    }
    mutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ny operatør</DialogTitle>
          <DialogDescription>
            Operatøren PIN-autentiserer i POS-klienten. PIN hashes server-side og lagres aldri i klartekst.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" autoComplete="off">
            {form.formState.errors.root?.message && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}

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

            <FormField
              control={form.control}
              name="operator_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Operatør-kode</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={8}
                      autoComplete="off"
                      className="font-mono uppercase"
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormDescription>2–8 tegn, A–Z og 0–9. Unik per selskap.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="pin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PIN</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete="new-password"
                        className="font-mono tracking-widest"
                      />
                    </FormControl>
                    <FormDescription>4–6 siffer</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirm_pin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bekreft PIN</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete="new-password"
                        className="font-mono tracking-widest"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Avbryt
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Oppretter…" : "Opprett operatør"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Rediger-dialog (ikke PIN)
// ──────────────────────────────────────────────────────────────────────────

const editSchema = z.object({
  display_name: z.string().trim().min(2, "Minst 2 tegn").max(100, "Maks 100 tegn"),
  operator_code: z.string().trim().toUpperCase().regex(OPERATOR_CODE_REGEX, "2–8 tegn, A–Z og 0–9"),
  status: z.enum(["active", "inactive"]),
});
type EditValues = z.infer<typeof editSchema>;

function EditOperatorDialog({
  open,
  onOpenChange,
  operator,
  activeEntityId,
  existingCodes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operator: Operator | null;
  activeEntityId: string;
  existingCodes: Set<string>;
}) {
  const queryClient = useQueryClient();
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { display_name: "", operator_code: "", status: "active" },
  });

  useEffect(() => {
    if (open && operator) {
      form.reset({
        display_name: operator.display_name,
        operator_code: operator.operator_code,
        status: operator.status,
      });
    }
  }, [open, operator, form]);

  const mutation = useMutation({
    mutationFn: async (values: EditValues) => {
      if (!operator) throw new Error("Ingen operatør valgt");
      const code = values.operator_code.trim().toUpperCase();
      if (code !== operator.operator_code && existingCodes.has(code)) {
        throw { code: "23505" };
      }
      const { error } = await supabase
        .from("pos_operators")
        .update({
          display_name: values.display_name.trim(),
          operator_code: code,
          status: values.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", operator.id)
        .eq("legal_entity_id", activeEntityId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_operators", activeEntityId] });
      toast.success("Operatør oppdatert");
      onOpenChange(false);
    },
    onError: (error) => {
      const code = getSupabaseErrorCode(error);
      if (code === "23505") {
        form.setError("operator_code", { message: "Kode finnes allerede for dette selskapet" });
        return;
      }
      form.setError("root", { message: getSupabaseErrorMessage(error) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rediger operatør</DialogTitle>
          <DialogDescription>PIN endres via egen handling i menyen.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4" autoComplete="off">
            {form.formState.errors.root?.message && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="display_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Visningsnavn</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={100} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="operator_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Operatør-kode</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={8}
                      className="font-mono uppercase"
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Aktiv</FormLabel>
                    <FormDescription>Inaktive operatører kan ikke logge inn på POS-klienten.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value === "active"}
                      onCheckedChange={(c) => field.onChange(c ? "active" : "inactive")}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Avbryt
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Lagrer…" : "Lagre"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sett-PIN-dialog
// ──────────────────────────────────────────────────────────────────────────

const setPinSchema = z
  .object({
    new_pin: z.string().regex(PIN_REGEX, "PIN må være 4–6 siffer"),
    confirm_pin: z.string(),
  })
  .refine((v) => v.new_pin === v.confirm_pin, {
    path: ["confirm_pin"],
    message: "PIN stemmer ikke",
  });
type SetPinValues = z.infer<typeof setPinSchema>;

function SetPinDialog({
  open,
  onOpenChange,
  operator,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operator: Operator | null;
}) {
  const form = useForm<SetPinValues>({
    resolver: zodResolver(setPinSchema),
    defaultValues: { new_pin: "", confirm_pin: "" },
  });

  useEffect(() => {
    // Sikkerhet: aldri behold PIN-state mellom åpninger
    form.reset({ new_pin: "", confirm_pin: "" });
  }, [open, operator, form]);

  const mutation = useMutation({
    mutationFn: async (values: SetPinValues) => {
      if (!operator) throw new Error("Ingen operatør valgt");
      const { error } = await supabase.rpc("pos_set_operator_pin", {
        p_operator_id: operator.id,
        p_new_pin: values.new_pin,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("PIN oppdatert");
      form.reset({ new_pin: "", confirm_pin: "" });
      onOpenChange(false);
    },
    onError: (error) => {
      // Ikke inkluder PIN i feilmelding
      form.setError("root", { message: getSupabaseErrorMessage(error) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sett ny PIN</DialogTitle>
          <DialogDescription>
            {operator ? `For ${operator.display_name} (${operator.operator_code})` : null}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4" autoComplete="off">
            {form.formState.errors.root?.message && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="new_pin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ny PIN</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      autoComplete="new-password"
                      className="font-mono tracking-widest"
                    />
                  </FormControl>
                  <FormDescription>4–6 siffer</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirm_pin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bekreft PIN</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      autoComplete="new-password"
                      className="font-mono tracking-widest"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Avbryt
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Lagrer…" : "Sett PIN"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Tilknytt-terminaler-dialog
// ──────────────────────────────────────────────────────────────────────────

function AssignTerminalsDialog({
  open,
  onOpenChange,
  operator,
  activeEntityId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operator: Operator | null;
  activeEntityId: string;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const terminalsQuery = useQuery({
    queryKey: ["pos_terminals", activeEntityId],
    queryFn: () => fetchTerminalsForEntity(activeEntityId),
    enabled: open && !!activeEntityId,
  });

  const linksQuery = useQuery({
    queryKey: ["pos_operator_terminals", operator?.id],
    queryFn: async () => {
      if (!operator) return [] as string[];
      const { data, error } = await supabase
        .from("pos_operator_terminals")
        .select("terminal_id")
        .eq("operator_id", operator.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.terminal_id as string);
    },
    enabled: open && !!operator,
  });

  useEffect(() => {
    if (open && linksQuery.data) {
      setSelected(new Set(linksQuery.data));
    }
  }, [open, linksQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!operator) throw new Error("Ingen operatør valgt");
      const current = new Set(linksQuery.data ?? []);
      const toAdd = [...selected].filter((id) => !current.has(id));
      const toRemove = [...current].filter((id) => !selected.has(id));

      if (toAdd.length > 0) {
        const { error } = await supabase
          .from("pos_operator_terminals")
          .insert(toAdd.map((terminal_id) => ({ operator_id: operator.id, terminal_id })));
        if (error) throw error;
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from("pos_operator_terminals")
          .delete()
          .eq("operator_id", operator.id)
          .in("terminal_id", toRemove);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pos_operator_terminals", operator?.id] }),
        queryClient.invalidateQueries({ queryKey: ["pos_operators", activeEntityId] }),
      ]);
      toast.success("Terminal-tilknytninger oppdatert");
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(getSupabaseErrorMessage(error));
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const terminals = terminalsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tilknytt terminaler</DialogTitle>
          <DialogDescription>
            {operator ? `${operator.display_name} (${operator.operator_code})` : null}
          </DialogDescription>
        </DialogHeader>

        {terminalsQuery.isLoading || linksQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : terminals.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Ingen terminaler er opprettet for dette selskapet ennå.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto rounded-lg border p-3">
            {terminals.map((t) => {
              const id = `term-${t.id}`;
              return (
                <label
                  key={t.id}
                  htmlFor={id}
                  className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    id={id}
                    checked={selected.has(t.id)}
                    onCheckedChange={() => toggle(t.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.display_name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{t.terminal_code}</div>
                  </div>
                  {t.status !== "active" && (
                    <Badge variant="outline" className="text-xs">
                      {t.status}
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending || terminals.length === 0}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Lagrer…" : "Lagre tilknytninger"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Hovedside
// ──────────────────────────────────────────────────────────────────────────

export default function Operatorer() {
  const { activeEntityId, activeEntity, isLoading: entityLoading, hasNoAccess } = useLegalEntity();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOperator, setEditOperator] = useState<Operator | null>(null);
  const [pinOperator, setPinOperator] = useState<Operator | null>(null);
  const [assignOperator, setAssignOperator] = useState<Operator | null>(null);
  const [deleteOperator, setDeleteOperator] = useState<Operator | null>(null);

  const operatorsQuery = useQuery({
    queryKey: ["pos_operators", activeEntityId],
    queryFn: () => fetchOperators(activeEntityId!),
    enabled: !!activeEntityId,
  });

  const existingCodes = useMemo(
    () => new Set((operatorsQuery.data ?? []).map((o) => o.operator_code)),
    [operatorsQuery.data],
  );

  const filtered = useMemo(() => {
    const rows = operatorsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((o) => {
      if (!showInactive && o.status === "inactive") return false;
      if (!q) return true;
      return (
        o.display_name.toLowerCase().includes(q) ||
        o.operator_code.toLowerCase().includes(q)
      );
    });
  }, [operatorsQuery.data, search, showInactive]);

  const toggleStatus = useMutation({
    mutationFn: async (op: Operator) => {
      const next: OperatorStatus = op.status === "active" ? "inactive" : "active";
      const { error } = await supabase
        .from("pos_operators")
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq("id", op.id)
        .eq("legal_entity_id", activeEntityId!);
      if (error) throw error;
      return next;
    },
    onSuccess: async (next) => {
      await queryClient.invalidateQueries({ queryKey: ["pos_operators", activeEntityId] });
      toast.success(next === "active" ? "Operatør aktivert" : "Operatør deaktivert");
    },
    onError: (error) => toast.error(getSupabaseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (op: Operator) => {
      const { error } = await supabase
        .from("pos_operators")
        .delete()
        .eq("id", op.id)
        .eq("legal_entity_id", activeEntityId!);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pos_operators", activeEntityId] });
      toast.success("Operatør slettet");
      setDeleteOperator(null);
    },
    onError: (error) => toast.error(getSupabaseErrorMessage(error)),
  });

  if (entityLoading) return <OperatorTableSkeleton />;

  if (hasNoAccess || !activeEntityId) {
    return (
      <div className="p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Du har ikke tilgang til POS Styring for noen selskap. Kontakt en administrator.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operatører</h1>
          <p className="text-sm text-muted-foreground">
            Kasse-operatører med PIN-kode og terminaltilknytning
            {activeEntity ? ` · ${activeEntity.short_code}` : ""}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Ny operatør
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Søk på navn eller kode…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={setShowInactive}
          />
          <Label htmlFor="show-inactive" className="cursor-pointer">
            Vis deaktiverte
          </Label>
        </div>
      </div>

      {operatorsQuery.isLoading ? (
        <OperatorTableSkeleton />
      ) : operatorsQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{getSupabaseErrorMessage(operatorsQuery.error)}</AlertDescription>
        </Alert>
      ) : (operatorsQuery.data ?? []).length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <h3 className="text-base font-medium">Ingen operatører ennå</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Opprett den første operatøren for {activeEntity?.short_code ?? "dette selskapet"}.
          </p>
          <Button className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Opprett operatør
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
          Ingen treff på «{search}»{!showInactive ? " (deaktiverte er skjult)" : ""}.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Navn</TableHead>
              <TableHead>Kode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Terminaler</TableHead>
              <TableHead>Siste innlogging</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((op) => {
              const hasLoggedIn = !!op.last_login_at;
              const deleteDisabled = hasLoggedIn;
              return (
                <TableRow key={op.id}>
                  <TableCell className="font-medium">{op.display_name}</TableCell>
                  <TableCell className="font-mono text-sm">{op.operator_code}</TableCell>
                  <TableCell>
                    <StatusBadge status={op.status} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{op.terminal_count}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {op.last_login_at
                      ? formatDistanceToNow(new Date(op.last_login_at), { addSuffix: true, locale: nb })
                      : "Aldri"}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onSelect={() => setEditOperator(op)}>
                          <PenLine className="h-4 w-4" />
                          Rediger
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPinOperator(op)}>
                          <KeyRound className="h-4 w-4" />
                          Sett ny PIN
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setAssignOperator(op)}>
                          <Plus className="h-4 w-4" />
                          Tilknytt terminaler
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => toggleStatus.mutate(op)}>
                          {op.status === "active" ? "Deaktiver" : "Aktiver"}
                        </DropdownMenuItem>
                        {deleteDisabled ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div>
                                <DropdownMenuItem
                                  disabled
                                  className="text-destructive focus:text-destructive"
                                  onSelect={(e) => e.preventDefault()}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Slett
                                </DropdownMenuItem>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="left">Bruk Deaktiver i stedet</TooltipContent>
                          </Tooltip>
                        ) : (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteOperator(op)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Slett
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <CreateOperatorDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        activeEntityId={activeEntityId}
        existingCodes={existingCodes}
      />

      <EditOperatorDialog
        open={!!editOperator}
        onOpenChange={(o) => !o && setEditOperator(null)}
        operator={editOperator}
        activeEntityId={activeEntityId}
        existingCodes={existingCodes}
      />

      <SetPinDialog
        open={!!pinOperator}
        onOpenChange={(o) => !o && setPinOperator(null)}
        operator={pinOperator}
      />

      <AssignTerminalsDialog
        open={!!assignOperator}
        onOpenChange={(o) => !o && setAssignOperator(null)}
        operator={assignOperator}
        activeEntityId={activeEntityId}
      />

      <AlertDialog open={!!deleteOperator} onOpenChange={(o) => !o && setDeleteOperator(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett operatør?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteOperator ? (
                <>
                  Dette sletter <strong>{deleteOperator.display_name}</strong> (
                  {deleteOperator.operator_code}) permanent. Dette kan ikke angres.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (deleteOperator) deleteMutation.mutate(deleteOperator);
              }}
            >
              {deleteMutation.isPending ? "Sletter…" : "Slett"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
