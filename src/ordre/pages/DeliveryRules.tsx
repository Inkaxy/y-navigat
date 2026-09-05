import { osloTodayISO } from "@/lib/osloDate";
import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, ListChecks, Search, Copy, ShieldAlert, TrendingUp, Ban, AlertTriangle, Info, Check } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { formatDateLong } from "@/ordre/lib/format";
import { logAudit } from "@/ordre/lib/audit";
import {
  useDeliveryRules,
  describeRule,
  findConflicts,
  RULE_TYPE_LABEL,
  RULE_TYPE_SHORT_LABEL,
  EFFECT_LABEL,
  WEEKDAY_LABELS_LONG,
  type DeliveryRule,
  type DeliveryRuleType,
  type DeliveryRuleEffect,
  type DeliveryRuleFilter,
  type NameLookup,
} from "@/ordre/hooks/useDeliveryRules";
import { useDeliveryTours, sortToursByPriority } from "@/ordre/hooks/useDeliveryTours";
import { DeliveryRuleFormDialog } from "@/ordre/components/orders/DeliveryRuleFormDialog";
import { cn } from "@/lib/utils";

const ALL_RULE_TYPES: DeliveryRuleType[] = [
  "order_deadline",
  "delivery_weekdays",
  "available_tours",
  "available_products",
  "no_delivery",
];

const TYPE_BADGE: Record<DeliveryRuleType, string> = {
  order_deadline: "bg-primary/10 text-primary",
  delivery_weekdays: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  available_tours: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  available_products: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  no_delivery: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const EFFECT_STYLE: Record<
  DeliveryRuleEffect,
  { badge: string; card: string; icon: typeof Ban }
> = {
  block: {
    badge: "bg-destructive/10 text-destructive border border-destructive/30",
    card: "border-l-4 border-l-destructive",
    icon: Ban,
  },
  warn: {
    badge:
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
    card: "border-l-4 border-l-amber-500",
    icon: AlertTriangle,
  },
  info: {
    badge:
      "bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/30",
    card: "border-l-4 border-l-blue-500",
    icon: Info,
  },
};

function ScopeChips({ rule, lookup }: { rule: DeliveryRule; lookup: NameLookup }) {
  const chips: { key: string; label: string }[] = [];

  if (rule.customer_group_ids?.length) {
    const names = rule.customer_group_ids
      .slice(0, 2)
      .map((id) => lookup.customerGroups?.get(id) ?? "gruppe");
    const extra = rule.customer_group_ids.length > 2 ? ` +${rule.customer_group_ids.length - 2}` : "";
    chips.push({ key: "cg", label: `Kundegruppe: ${names.join(", ")}${extra}` });
  }
  if (rule.customer_ids?.length) {
    const names = rule.customer_ids.slice(0, 2).map((id) => lookup.customers?.get(id) ?? "kunde");
    const extra = rule.customer_ids.length > 2 ? ` +${rule.customer_ids.length - 2}` : "";
    chips.push({ key: "c", label: `Kunder: ${names.join(", ")}${extra}` });
  }
  if (!rule.customer_group_ids?.length && !rule.customer_ids?.length) {
    chips.push({ key: "call", label: "Alle kunder" });
  }
  if (rule.weekdays?.length && rule.weekdays.length < 7) {
    chips.push({
      key: "wd",
      label: rule.weekdays.map((d) => WEEKDAY_LABELS_LONG[d - 1]).join(", "),
    });
  }
  if (rule.tour_filter?.length && rule.rule_type !== "available_tours") {
    const names = rule.tour_filter.slice(0, 2).map((id) => lookup.tours?.get(id) ?? "tur");
    const extra = rule.tour_filter.length > 2 ? ` +${rule.tour_filter.length - 2}` : "";
    chips.push({ key: "t", label: `Turer: ${names.join(", ")}${extra}` });
  }
  if (rule.specific_delivery_date) {
    chips.push({ key: "d", label: `Kun ${rule.specific_delivery_date}` });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.key}
          className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

export default function DeliveryRules() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<NonNullable<DeliveryRuleFilter["status"]>>("active");
  const [typeFilter, setTypeFilter] = useState<DeliveryRuleType[]>([]);
  const [showExpired, setShowExpired] = useState(false);

  const { data: rawRules = [], isLoading } = useDeliveryRules({
    search,
    status,
    ruleType: "all",
  });

  const todayISO = osloTodayISO();
  const rules = useMemo(
    () =>
      rawRules.filter((r) => {
        if (typeFilter.length > 0 && !typeFilter.includes(r.rule_type)) return false;
        const expired = !!r.valid_until && r.valid_until < todayISO;
        if (expired && !showExpired) return false;
        return true;
      }),
    [rawRules, typeFilter, showExpired, todayISO],
  );
  const expiredCount = useMemo(
    () => rawRules.filter((r) => !!r.valid_until && r.valid_until < todayISO).length,
    [rawRules, todayISO],
  );
  const { data: allActiveRules = [] } = useDeliveryRules({ status: "active", ruleType: "all" });

  const { data: tours = [] } = useDeliveryTours();
  const tourMap = useMemo(() => {
    const m = new Map<string, string>();
    sortToursByPriority(tours).forEach((t) => m.set(t.id, t.display_name));
    return m;
  }, [tours]);

  // Slå opp navn for referanser
  const allCustomerIds = useMemo(
    () => Array.from(new Set(rules.flatMap((r) => r.customer_ids ?? []))),
    [rules],
  );
  const allProductIds = useMemo(
    () => Array.from(new Set(rules.flatMap((r) => r.product_ids ?? []))),
    [rules],
  );
  const allCustomerGroupIds = useMemo(
    () => Array.from(new Set(rules.flatMap((r) => r.customer_group_ids ?? []))),
    [rules],
  );
  const allProductGroupIds = useMemo(
    () => Array.from(new Set(rules.flatMap((r) => r.product_group_ids ?? []))),
    [rules],
  );

  const { data: customerLookup = [] } = useQuery({
    queryKey: ["dr-customer-lookup", allCustomerIds.sort().join(",")],
    enabled: allCustomerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, display_name")
        .in("id", allCustomerIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: productLookup = [] } = useQuery({
    queryKey: ["dr-product-lookup", allProductIds.sort().join(",")],
    enabled: allProductIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, display_name")
        .in("id", allProductIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: customerGroupLookup = [] } = useQuery({
    queryKey: ["dr-cgroup-lookup", allCustomerGroupIds.sort().join(",")],
    enabled: allCustomerGroupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_groups")
        .select("id, display_name")
        .in("id", allCustomerGroupIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: salesGroupLookup = [] } = useQuery({
    queryKey: ["dr-sgroup-lookup", allProductGroupIds.sort().join(",")],
    enabled: allProductGroupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_groups")
        .select("id, display_name")
        .in("id", allProductGroupIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const nameLookup: NameLookup = useMemo(
    () => ({
      customers: new Map(customerLookup.map((c) => [c.id, c.display_name])),
      products: new Map(productLookup.map((p) => [p.id, p.display_name])),
      customerGroups: new Map(customerGroupLookup.map((g) => [g.id, g.display_name])),
      productGroups: new Map(salesGroupLookup.map((g) => [g.id, g.display_name])),
      tours: tourMap,
    }),
    [customerLookup, productLookup, customerGroupLookup, salesGroupLookup, tourMap],
  );

  // Overstyringer siste 30 dager
  const { data: overrides = [] } = useQuery({
    queryKey: ["dr-overrides-30d"],
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const { data, error } = await supabase
        .from("audit_log")
        .select("changes, occurred_at")
        .eq("action", "delivery_rule_overridden")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .gte("occurred_at", from.toISOString())
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const overrideCountByRule = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of overrides) {
      const ids: string[] = (row.changes as { rule_ids?: string[] } | null)?.rule_ids ?? [];
      for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [overrides]);

  // KPI-teller
  const counts = useMemo(() => {
    const c = { active: 0, block: 0, warn: 0, info: 0, inactive: 0 };
    for (const r of allActiveRules) {
      c.active++;
      c[r.effect]++;
    }
    return c;
  }, [allActiveRules]);

  // Konflikter (per aktiv regel)
  const conflictsByRule = useMemo(() => {
    const m = new Map<string, ReturnType<typeof findConflicts>>();
    for (const r of rules) {
      if (!r.is_active) continue;
      const c = findConflicts(r, allActiveRules);
      if (c.length > 0) m.set(r.id, c);
    }
    return m;
  }, [rules, allActiveRules]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryRule | null>(null);
  const [template, setTemplate] = useState<DeliveryRule | null>(null);
  const [deleting, setDeleting] = useState<DeliveryRule | null>(null);
  const [busy, setBusy] = useState(false);

  function openNew() {
    setEditing(null);
    setTemplate(null);
    setFormOpen(true);
  }
  function openEdit(r: DeliveryRule) {
    setEditing(r);
    setTemplate(null);
    setFormOpen(true);
  }
  function openDuplicate(r: DeliveryRule) {
    setEditing(null);
    setTemplate(r);
    setFormOpen(true);
  }

  async function handleHardDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("delivery_rules")
        .delete()
        .eq("id", deleting.id);
      if (error) throw error;
      await logAudit({
        action: "deleted",
        entity_type: "delivery_rule",
        entity_id: deleting.id,
        entity_display_reference: deleting.name,
        legal_entity_id: NB_LEGAL_ENTITY_ID,
      });
      toast.success("Regel slettet");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["delivery-rules"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke slette regel");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(r: DeliveryRule) {
    const { error } = await supabase
      .from("delivery_rules")
      .update({ is_active: !r.is_active })
      .eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(r.is_active ? "Regel deaktivert" : "Regel aktivert");
    void qc.invalidateQueries({ queryKey: ["delivery-rules"] });
  }

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["delivery-rules"] });
  }

  return (
    <>
      <AppBanner
        title="Leveringsregler"
        subtitle="Ordrefrister, blackout-dager, tur- og vare-tilgang for Nøtterø Bakeri AS"
        icon={ListChecks}
        actions={
          <Button onClick={openNew} size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> Ny regel
          </Button>
        }
      />

      <div className="container mx-auto space-y-4 px-4 py-6 sm:px-6">
        {/* KPI-rad */}
        <div className="grid gap-3 sm:grid-cols-4">
          <KpiCard icon={ListChecks} label="Aktive regler" value={counts.active} tone="default" />
          <KpiCard icon={Ban} label="Blokkerer" value={counts.block} tone="block" />
          <KpiCard icon={AlertTriangle} label="Advarer" value={counts.warn} tone="warn" />
          <KpiCard
            icon={TrendingUp}
            label="Overstyringer (30 d)"
            value={overrides.length}
            tone="info"
          />
        </div>

        {/* Filtre */}
        <Card className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk navn eller beskrivelse..."
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {ALL_RULE_TYPES.map((t) => {
              const active = typeFilter.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={active}
                  title={RULE_TYPE_LABEL[t]}
                  onClick={() =>
                    setTypeFilter((prev) =>
                      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                    )
                  }
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border",
                      active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                    )}
                  >
                    {active && <Check className="h-2.5 w-2.5" />}
                  </span>
                  {RULE_TYPE_SHORT_LABEL[t]}
                </button>
              );
            })}
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Aktive</SelectItem>
              <SelectItem value="inactive">Inaktive</SelectItem>
              <SelectItem value="all">Alle</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={showExpired} onCheckedChange={setShowExpired} />
            Vis også utgåtte regler{expiredCount > 0 ? ` (${expiredCount})` : ""}
          </label>
        </Card>

        {/* Kort-liste */}
        {isLoading ? (
          <Card className="py-16 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          </Card>
        ) : rules.length === 0 ? (
          <Card className="py-16 text-center">
            <div className="mx-auto max-w-md space-y-2">
              <ListChecks className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <div className="text-sm font-medium">Ingen leveringsregler ennå</div>
              <p className="text-xs text-muted-foreground">
                Opprett en ordrefrist, blackout-dag eller vare-restriksjon for å
                styre hva ordrekontoret og kundeportalen kan lagre.
              </p>
              <Button onClick={openNew} size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Opprett din første regel
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid gap-3">
            {rules.map((r) => {
              const style = EFFECT_STYLE[r.effect];
              const overrideCount = overrideCountByRule.get(r.id) ?? 0;
              const conflicts = conflictsByRule.get(r.id) ?? [];
              return (
                <Card
                  key={r.id}
                  className={cn(
                    "cursor-pointer p-4 transition-colors hover:bg-accent/30",
                    style.card,
                    !r.is_active && "opacity-60",
                  )}
                  onClick={() => openEdit(r)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                            TYPE_BADGE[r.rule_type],
                          )}
                        >
                          {RULE_TYPE_SHORT_LABEL[r.rule_type]}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            style.badge,
                          )}
                        >
                          <style.icon className="h-3 w-3" />
                          {EFFECT_LABEL[r.effect]}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Prioritet {r.priority}
                        </span>
                        {!r.is_active && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                            Inaktiv
                          </span>
                        )}
                        {overrideCount > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                                <ShieldAlert className="h-3 w-3" />
                                {overrideCount} overstyring{overrideCount === 1 ? "" : "er"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Siste 30 dager</TooltipContent>
                          </Tooltip>
                        )}
                        {conflicts.length > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                                <AlertTriangle className="h-3 w-3" />
                                Overlapper {conflicts.length}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[280px]">
                              <div className="text-xs font-semibold">Overlappende regler:</div>
                              <ul className="mt-1 space-y-0.5 text-xs">
                                {conflicts.slice(0, 5).map((c) => (
                                  <li key={c.otherId}>
                                    {c.wins === "self"
                                      ? "▲"
                                      : c.wins === "other"
                                        ? "▼"
                                        : "="}{" "}
                                    {c.otherName} (P{c.otherPriority})
                                  </li>
                                ))}
                              </ul>
                              <div className="mt-1 text-[10px] italic text-muted-foreground">
                                Høyest prioritet vinner ved treff.
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>

                      <div>
                        <div className="text-sm font-semibold">{r.name}</div>
                        {r.description && (
                          <div className="text-xs text-muted-foreground">{r.description}</div>
                        )}
                      </div>

                      <div className="space-y-0.5">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Definerer
                        </div>
                        <p className="text-xs leading-relaxed text-foreground/80">
                          {describeRule(r, nameLookup)}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Gjelder for
                        </div>
                        <ScopeChips rule={r} lookup={nameLookup} />
                      </div>

                      <div className="text-[11px] text-muted-foreground">
                        {r.valid_until ? (
                          <>
                            Gyldig {formatDateLong(r.valid_from)} — {formatDateLong(r.valid_until)}
                          </>
                        ) : (
                          <>Gyldig fra {formatDateLong(r.valid_from)}</>
                        )}
                      </div>
                    </div>

                    <div
                      className="flex shrink-0 flex-col gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(r)}
                        className="h-8 w-8 p-0"
                        aria-label="Rediger"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openDuplicate(r)}
                        className="h-8 w-8 p-0"
                        aria-label="Kopier"
                        title="Lag kopi"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleActive(r)}
                        className="h-8 px-2 text-[11px]"
                        title={r.is_active ? "Deaktiver" : "Aktiver"}
                      >
                        {r.is_active ? "Av" : "På"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(r)}
                        className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                        aria-label="Slett"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <DeliveryRuleFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        rule={editing}
        template={template}
        onSaved={refresh}
      />
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett «{deleting?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Regelen fjernes permanent og vil ikke lenger gjelde for nye ordre.
              Bruk «Deaktiver» i stedet hvis du ønsker å kunne aktivere regelen senere.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleHardDelete} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
  tone: "default" | "block" | "warn" | "info";
}) {
  const iconClass =
    tone === "block"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "info"
          ? "text-blue-600 dark:text-blue-400"
          : "text-primary";
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
        <Icon className={cn("h-5 w-5", iconClass)} />
      </div>
    </Card>
  );
}
