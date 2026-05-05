import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertTriangle,
  Ban,
  Info,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { logAudit } from "@/varer/lib/audit";

type Severity = "info" | "warning" | "block";
type RuleType = "require_all_selected" | "require_any_two_selected";
export type ResponseAction = "continue" | "block" | "remove_product";

export interface ResponseOption {
  id: string;
  label: string;
  action: ResponseAction;
  remove_product_id?: string | null;
  is_primary?: boolean;
}

interface Rule {
  id: string;
  cake_category_id: string;
  name: string;
  trigger_product_ids: string[];
  rule_type: string;
  severity: string;
  message: string;
  is_active: boolean;
  sort_order: number;
  response_options?: ResponseOption[] | null;
}

export interface RuleProductOption {
  /** Stable id used in trigger_product_ids. For real products = product UUID. For name-only = `custom:<step_product_id>`. */
  id: string;
  label: string;
  step_name: string;
}

interface Props {
  cakeCategoryId: string;
  canWrite: boolean;
  /** All selectable items across all steps in this category (products + name-only blocks). */
  options: RuleProductOption[];
}

const SEVERITY_META: Record<Severity, { label: string; icon: typeof Info; cls: string }> = {
  info: { label: "Info", icon: Info, cls: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  warning: { label: "Advarsel", icon: AlertTriangle, cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  block: { label: "Blokker", icon: Ban, cls: "bg-destructive/10 text-destructive border-destructive/30" },
};

const RULE_TYPE_LABEL: Record<RuleType, string> = {
  require_all_selected: "Alle disse må være valgt",
  require_any_two_selected: "Minst to av disse valgt",
};

export function CompatibilityRulesSection({ cakeCategoryId, canWrite, options }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const rulesQuery = useQuery({
    queryKey: ["cake-compat-rules", cakeCategoryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cake_compatibility_rules")
        .select("*")
        .eq("cake_category_id", cakeCategoryId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown) as Rule[];
    },
  });

  const optionsById = useMemo(() => {
    const m = new Map<string, RuleProductOption>();
    options.forEach((o) => m.set(o.id, o));
    return m;
  }, [options]);

  const toggleActive = useMutation({
    mutationFn: async (rule: Rule) => {
      const { error } = await supabase
        .from("cake_compatibility_rules")
        .update({ is_active: !rule.is_active })
        .eq("id", rule.id);
      if (error) throw error;
      await logAudit({
        action: "cake_compatibility_rule_toggled",
        entity_type: "cake_compatibility_rule",
        entity_id: rule.id,
        entity_display_reference: rule.name,
        changes: { is_active: !rule.is_active },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cake-compat-rules", cakeCategoryId] }),
    onError: (e: any) => toast({ title: "Kunne ikke oppdatere", description: e.message, variant: "destructive" }),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const rule = rulesQuery.data?.find((r) => r.id === id);
      const { error } = await supabase.from("cake_compatibility_rules").delete().eq("id", id);
      if (error) throw error;
      await logAudit({
        action: "cake_compatibility_rule_deleted",
        entity_type: "cake_compatibility_rule",
        entity_id: id,
        entity_display_reference: rule?.name ?? id,
      });
    },
    onSuccess: () => {
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ["cake-compat-rules", cakeCategoryId] });
      toast({ title: "Regel slettet" });
    },
    onError: (e: any) => toast({ title: "Kunne ikke slette", description: e.message, variant: "destructive" }),
  });

  const rules = rulesQuery.data ?? [];

  return (
    <div className="px-6 pb-8">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
          <div>
            <div className="font-medium">Varsler & regler</div>
            <div className="text-xs text-muted-foreground">
              Vis info, advarsler eller blokker bestemte produktkombinasjoner i wizarden.
            </div>
          </div>
          {canWrite && (
            <Button
              size="sm"
              onClick={() => {
                setEditingRule(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Ny regel
            </Button>
          )}
        </div>

        {rulesQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rules.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Ingen regler ennå. F.eks: <span className="italic">«OBS – vaniljekremen inneholder laktose»</span>{" "}
            som vises hvis kunden velger både vaniljekrem og laktosefri krem.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rules.map((rule) => {
              const sev = (SEVERITY_META[rule.severity as Severity] ?? SEVERITY_META.warning);
              const Icon = sev.icon;
              const triggerLabels = rule.trigger_product_ids.map(
                (id) => optionsById.get(id)?.label ?? "(ukjent)",
              );
              return (
                <div
                  key={rule.id}
                  className={cn(
                    "px-4 py-3 transition-opacity",
                    !rule.is_active && "opacity-50",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("mt-0.5 rounded-md border p-1.5", sev.cls)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{rule.name}</span>
                        <Badge variant="outline" className={cn("text-[10px]", sev.cls)}>
                          {sev.label}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {RULE_TYPE_LABEL[rule.rule_type as RuleType] ?? rule.rule_type}
                        </Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{rule.message}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {triggerLabels.map((label, i) => (
                          <Badge key={i} variant="secondary" className="text-[11px]">
                            {label}
                          </Badge>
                        ))}
                      </div>
                      {rule.response_options && rule.response_options.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {rule.response_options.map((opt) => (
                            <Badge
                              key={opt.id}
                              variant="outline"
                              className={cn(
                                "text-[11px] gap-1",
                                opt.action === "continue" && "border-emerald-500/40 text-emerald-600 bg-emerald-500/5",
                                opt.action === "block" && "border-destructive/40 text-destructive bg-destructive/5",
                                opt.action === "remove_product" && "border-amber-500/40 text-amber-600 bg-amber-500/5",
                              )}
                            >
                              {opt.is_primary && <span>★</span>}
                              {opt.label}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={rule.is_active}
                        onCheckedChange={() => toggleActive.mutate(rule)}
                        disabled={!canWrite || toggleActive.isPending}
                      />
                      {canWrite && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setEditingRule(rule);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteId(rule.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <RuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cakeCategoryId={cakeCategoryId}
        rule={editingRule}
        options={options}
        onSaved={() => qc.invalidateQueries({ queryKey: ["cake-compat-rules", cakeCategoryId] })}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette regel?</AlertDialogTitle>
            <AlertDialogDescription>Dette kan ikke angres.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteRule.mutate(deleteId)}>
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ===================== Rule dialog =====================

interface RuleDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cakeCategoryId: string;
  rule: Rule | null;
  options: RuleProductOption[];
  onSaved: () => void;
}

function RuleDialog({ open, onOpenChange, cakeCategoryId, rule, options, onSaved }: RuleDialogProps) {
  const { toast } = useToast();
  const isEdit = !!rule;
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<Severity>("warning");
  const [ruleType, setRuleType] = useState<RuleType>("require_all_selected");
  const [triggerIds, setTriggerIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [responseOptions, setResponseOptions] = useState<ResponseOption[]>([]);

  useEffect(() => {
    if (open) {
      setName(rule?.name ?? "");
      setMessage(rule?.message ?? "");
      setSeverity((rule?.severity as Severity) ?? "warning");
      setRuleType((rule?.rule_type as RuleType) ?? "require_all_selected");
      setTriggerIds(rule?.trigger_product_ids ?? []);
      setResponseOptions(rule?.response_options ?? []);
    }
  }, [open, rule]);

  const optionsById = useMemo(() => {
    const m = new Map<string, RuleProductOption>();
    options.forEach((o) => m.set(o.id, o));
    return m;
  }, [options]);

  const save = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      const trimmedMsg = message.trim();
      if (!trimmedName) throw new Error("Navn er påkrevd");
      if (!trimmedMsg) throw new Error("Melding er påkrevd");
      if (triggerIds.length < 2) throw new Error("Velg minst 2 produkter");
      if (responseOptions.length === 0) throw new Error("Legg til minst ett svar-alternativ");
      const cleanedOptions = responseOptions.map((o) => ({
        ...o,
        label: o.label.trim(),
      }));
      if (cleanedOptions.some((o) => !o.label)) throw new Error("Alle svar-alternativer må ha en tekst");
      if (cleanedOptions.some((o) => o.action === "remove_product" && !o.remove_product_id)) {
        throw new Error("Velg hvilket produkt som skal fjernes for handlingen «Fjern produkt»");
      }

      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id ?? null;

      if (isEdit && rule) {
        const { error } = await supabase
          .from("cake_compatibility_rules")
          .update({
            name: trimmedName,
            message: trimmedMsg,
            severity,
            rule_type: ruleType,
            trigger_product_ids: triggerIds,
            response_options: cleanedOptions as never,
            updated_by: userId,
          })
          .eq("id", rule.id);
        if (error) throw error;
        await logAudit({
          action: "cake_compatibility_rule_updated",
          entity_type: "cake_compatibility_rule",
          entity_id: rule.id,
          entity_display_reference: trimmedName,
          changes: { severity, rule_type: ruleType, trigger_count: triggerIds.length, response_count: cleanedOptions.length },
        });
        return rule.id;
      }

      const { data, error } = await supabase
        .from("cake_compatibility_rules")
        .insert({
          cake_category_id: cakeCategoryId,
          name: trimmedName,
          message: trimmedMsg,
          severity,
          rule_type: ruleType,
          trigger_product_ids: triggerIds,
          response_options: cleanedOptions as never,
          is_active: true,
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        action: "cake_compatibility_rule_created",
        entity_type: "cake_compatibility_rule",
        entity_id: data.id,
        entity_display_reference: trimmedName,
      });
      return data.id;
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Regel oppdatert" : "Regel opprettet" });
      onSaved();
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Kunne ikke lagre", description: e.message, variant: "destructive" }),
  });

  const sevMeta = SEVERITY_META[severity];
  const PreviewIcon = sevMeta.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rediger regel" : "Ny regel"}</DialogTitle>
          <DialogDescription>
            Reglen utløses når kunden velger en bestemt kombinasjon av produkter.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rule-name">Navn (intern)</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Laktose-varsel ved vaniljekrem"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Alvorlighet</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">🔵 Info — passiv badge</SelectItem>
                  <SelectItem value="warning">🟡 Advarsel — popup, kan fortsette</SelectItem>
                  <SelectItem value="block">🔴 Blokker — må endres for å gå videre</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Trigger</Label>
            <Select value={ruleType} onValueChange={(v) => setRuleType(v as RuleType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="require_all_selected">Alle disse må være valgt (AND)</SelectItem>
                <SelectItem value="require_any_two_selected">Minst to av disse valgt</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Produkter som utløser regelen</Label>
            <div className="flex flex-wrap gap-1.5 rounded-md border border-border p-2 min-h-[42px]">
              {triggerIds.length === 0 ? (
                <span className="text-xs text-muted-foreground self-center px-1">
                  Ingen valgt — klikk «Legg til» under
                </span>
              ) : (
                triggerIds.map((id) => {
                  const opt = optionsById.get(id);
                  return (
                    <Badge key={id} variant="secondary" className="gap-1 pr-1">
                      <span>{opt?.label ?? "(ukjent)"}</span>
                      {opt && (
                        <span className="text-[10px] text-muted-foreground">· {opt.step_name}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setTriggerIds((prev) => prev.filter((x) => x !== id))}
                        className="ml-1 rounded-sm hover:bg-background/60"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })
              )}
            </div>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" type="button" className="mt-1">
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Legg til produkt
                  <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[420px]" align="start">
                <Command>
                  <CommandInput placeholder="Søk produkt eller navn…" />
                  <CommandList>
                    <CommandEmpty>Ingen treff.</CommandEmpty>
                    <CommandGroup>
                      {options.map((opt) => {
                        const checked = triggerIds.includes(opt.id);
                        return (
                          <CommandItem
                            key={opt.id}
                            value={`${opt.label} ${opt.step_name}`}
                            onSelect={() => {
                              setTriggerIds((prev) =>
                                checked ? prev.filter((x) => x !== opt.id) : [...prev, opt.id],
                              );
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                checked ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="truncate">{opt.label}</div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {opt.step_name}
                              </div>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-msg">Melding til kunden</Label>
            <Textarea
              id="rule-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="OBS – vaniljekremen inneholder laktose. Er dette greit for kunden?"
            />
          </div>

          {/* Response options editor */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Svar-alternativer</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setResponseOptions((prev) => [
                    ...prev,
                    {
                      id: crypto.randomUUID(),
                      label: "",
                      action: "continue",
                      is_primary: prev.length === 0,
                    },
                  ])
                }
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Legg til svar
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Knapper kunden ser i popup-en. Marker én som primær (★).
            </p>
            {responseOptions.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                Ingen svar-alternativer ennå. F.eks: «Ja, det er greit» (fortsett) og «Nei, bytt krem» (fjern produkt).
              </div>
            ) : (
              <div className="space-y-2">
                {responseOptions.map((opt, idx) => (
                  <div
                    key={opt.id}
                    className="flex flex-wrap items-start gap-2 rounded-md border border-border bg-muted/20 p-2"
                  >
                    <Button
                      type="button"
                      size="icon"
                      variant={opt.is_primary ? "default" : "ghost"}
                      className="h-8 w-8 shrink-0"
                      title={opt.is_primary ? "Primært svar" : "Sett som primært"}
                      onClick={() =>
                        setResponseOptions((prev) =>
                          prev.map((o, i) => ({ ...o, is_primary: i === idx })),
                        )
                      }
                    >
                      <span className={cn("text-base", opt.is_primary ? "text-primary-foreground" : "text-muted-foreground")}>★</span>
                    </Button>
                    <Input
                      placeholder="Knappetekst (f.eks. «Ja, det er greit»)"
                      value={opt.label}
                      onChange={(e) =>
                        setResponseOptions((prev) =>
                          prev.map((o, i) => (i === idx ? { ...o, label: e.target.value } : o)),
                        )
                      }
                      className="h-8 flex-1 min-w-[160px]"
                    />
                    <Select
                      value={opt.action}
                      onValueChange={(v) =>
                        setResponseOptions((prev) =>
                          prev.map((o, i) =>
                            i === idx
                              ? {
                                  ...o,
                                  action: v as ResponseAction,
                                  remove_product_id: v === "remove_product" ? o.remove_product_id : null,
                                }
                              : o,
                          ),
                        )
                      }
                    >
                      <SelectTrigger className="h-8 w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="continue">✅ Fortsett</SelectItem>
                        <SelectItem value="block">⛔ Avbryt / blokker</SelectItem>
                        <SelectItem value="remove_product">🗑️ Fjern produkt</SelectItem>
                      </SelectContent>
                    </Select>
                    {opt.action === "remove_product" && (
                      <Select
                        value={opt.remove_product_id ?? ""}
                        onValueChange={(v) =>
                          setResponseOptions((prev) =>
                            prev.map((o, i) =>
                              i === idx ? { ...o, remove_product_id: v } : o,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-[200px]">
                          <SelectValue placeholder="Velg produkt å fjerne" />
                        </SelectTrigger>
                        <SelectContent>
                          {triggerIds.map((id) => {
                            const o = optionsById.get(id);
                            return (
                              <SelectItem key={id} value={id}>
                                {o?.label ?? "(ukjent)"}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={() =>
                        setResponseOptions((prev) => {
                          const next = prev.filter((_, i) => i !== idx);
                          if (next.length > 0 && !next.some((o) => o.is_primary)) {
                            next[0] = { ...next[0], is_primary: true };
                          }
                          return next;
                        })
                      }
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live preview */}
          {message.trim() && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Forhåndsvisning</Label>
              <div className={cn("rounded-md border p-3", sevMeta.cls)}>
                <div className="flex items-start gap-3">
                  <PreviewIcon className="h-5 w-5 mt-0.5 shrink-0" />
                  <div className="text-sm">{message}</div>
                </div>
                {responseOptions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 pl-8">
                    {responseOptions.map((opt) => (
                      <Button
                        key={opt.id}
                        type="button"
                        size="sm"
                        variant={opt.is_primary ? "default" : "outline"}
                        className="h-8"
                        disabled
                      >
                        {opt.label || <span className="italic opacity-60">Tom tekst</span>}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Lagre" : "Opprett"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
