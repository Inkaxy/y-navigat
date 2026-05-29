import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, ListChecks, Search, Copy } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  formatRuleDefinition,
  WEEKDAY_LABELS_LONG,
  RULE_TYPE_LABEL,
  RULE_TYPE_SHORT_LABEL,
  type DeliveryRule,
  type DeliveryRuleType,
  type DeliveryRuleFilter,
} from "@/ordre/hooks/useDeliveryRules";
import { useDeliveryTours, sortToursByPriority } from "@/ordre/hooks/useDeliveryTours";
import { useQuery } from "@tanstack/react-query";
import { DeliveryRuleFormDialog } from "@/ordre/components/orders/DeliveryRuleFormDialog";

const RULE_TYPE_BADGE: Record<DeliveryRuleType, string> = {
  order_deadline: "bg-primary/10 text-primary",
  delivery_weekdays: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  available_tours: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  available_products: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  no_delivery: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

function RuleTypeBadge({ type }: { type: DeliveryRuleType }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${RULE_TYPE_BADGE[type]}`}
    >
      {RULE_TYPE_SHORT_LABEL[type]}
    </span>
  );
}


function ScopeText({
  rule,
  tourMap,
  customerNames,
  productNames,
}: {
  rule: DeliveryRule;
  tourMap: Map<string, string>;
  customerNames: Map<string, string>;
  productNames: Map<string, string>;
}) {
  const lines: string[] = [];

  // Ukedager
  if (!rule.weekdays || rule.weekdays.length === 0) {
    lines.push("Ukedager: alle");
  } else {
    const days = rule.weekdays.map((d) => WEEKDAY_LABELS_LONG[d - 1]).join(", ");
    lines.push(`Ukedager: ${days}`);
  }

  // Turer
  if (!rule.tour_filter || rule.tour_filter.length === 0) {
    lines.push("Turer: alle");
  } else {
    const names = rule.tour_filter.map((id) => tourMap.get(id) ?? "ukjent").join(", ");
    lines.push(`Turer: ${names}`);
  }

  // Varer
  if (!rule.product_ids || rule.product_ids.length === 0) {
    lines.push("Varer: alle");
  } else {
    const names = rule.product_ids
      .slice(0, 3)
      .map((id) => productNames.get(id) ?? "ukjent")
      .join(", ");
    const extra = rule.product_ids.length > 3 ? ` +${rule.product_ids.length - 3}` : "";
    lines.push(`Varer: ${names}${extra}`);
  }

  // Kunder
  if (!rule.customer_ids || rule.customer_ids.length === 0) {
    lines.push("Kunder: alle");
  } else {
    const names = rule.customer_ids
      .slice(0, 3)
      .map((id) => customerNames.get(id) ?? "ukjent")
      .join(", ");
    const extra = rule.customer_ids.length > 3 ? ` +${rule.customer_ids.length - 3}` : "";
    lines.push(`Kunder: ${names}${extra}`);
  }

  return (
    <div className="space-y-0.5 text-xs leading-snug text-muted-foreground">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

export default function DeliveryRules() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<NonNullable<DeliveryRuleFilter["status"]>>("active");
  const [ruleType, setRuleType] = useState<NonNullable<DeliveryRuleFilter["ruleType"]>>("all");

  const { data: rules = [], isLoading } = useDeliveryRules({ search, status, ruleType });


  const { data: tours = [] } = useDeliveryTours();
  const tourMap = useMemo(() => {
    const m = new Map<string, string>();
    sortToursByPriority(tours).forEach((t) => m.set(t.id, t.display_name));
    return m;
  }, [tours]);

  // Hent navn for alle refererte kunder/produkter på tvers av regler
  const allCustomerIds = useMemo(
    () => Array.from(new Set(rules.flatMap((r) => r.customer_ids ?? []))),
    [rules],
  );
  const allProductIds = useMemo(
    () => Array.from(new Set(rules.flatMap((r) => r.product_ids ?? []))),
    [rules],
  );

  const { data: customerLookup = [] } = useQuery({
    queryKey: ["delivery-rules-customer-lookup", allCustomerIds.sort().join(",")],
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
    queryKey: ["delivery-rules-product-lookup", allProductIds.sort().join(",")],
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

  const customerNames = useMemo(() => {
    const m = new Map<string, string>();
    customerLookup.forEach((c) => m.set(c.id, c.display_name));
    return m;
  }, [customerLookup]);
  const productNames = useMemo(() => {
    const m = new Map<string, string>();
    productLookup.forEach((p) => m.set(p.id, p.display_name));
    return m;
  }, [productLookup]);

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
        subtitle="Ordrefrister og leveranseregler for Nøtterø Bakeri AS"
        icon={ListChecks}
        actions={
          <Button onClick={openNew} size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> Ny regel
          </Button>
        }
      />

      <div className="container mx-auto space-y-4 px-4 py-6 sm:px-6">
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
          <Select value={ruleType} onValueChange={(v) => setRuleType(v as typeof ruleType)}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle regeltyper</SelectItem>
              <SelectItem value="order_deadline">{RULE_TYPE_LABEL.order_deadline}</SelectItem>
              <SelectItem value="delivery_weekdays">{RULE_TYPE_LABEL.delivery_weekdays}</SelectItem>
              <SelectItem value="available_tours">{RULE_TYPE_LABEL.available_tours}</SelectItem>
              <SelectItem value="available_products">{RULE_TYPE_LABEL.available_products}</SelectItem>
              <SelectItem value="no_delivery">{RULE_TYPE_LABEL.no_delivery}</SelectItem>
            </SelectContent>
          </Select>

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
        </Card>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="w-28">Type</TableHead>
                <TableHead>Navn</TableHead>
                <TableHead>Definerer</TableHead>
                <TableHead>Gjelder for</TableHead>
                <TableHead>Gyldig</TableHead>
                <TableHead className="w-24 text-right">Handlinger</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center">
                    <div className="mx-auto max-w-md space-y-2">
                      <ListChecks className="mx-auto h-10 w-10 text-muted-foreground/40" />
                      <div className="text-sm font-medium">Ingen leveringsregler ennå</div>
                      <p className="text-xs text-muted-foreground">
                        Opprett en ordrefrist for å varsle operatører når en ordre legges
                        inn for sent. Regler er ikke-blokkerende — de gir kun advarsel.
                      </p>
                      <Button onClick={openNew} size="sm" className="gap-1.5">
                        <Plus className="h-3.5 w-3.5" /> Opprett din første regel
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rules.map((r, idx) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-accent/40"
                    onClick={() => openEdit(r)}
                  >
                    <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>
                      <RuleTypeBadge type={r.rule_type} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      {r.description && (
                        <div className="text-xs text-muted-foreground">{r.description}</div>
                      )}
                      {!r.is_active && (
                        <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                          Inaktiv
                        </span>
                      )}
                    <TableCell className="text-sm">
                      {formatRuleDefinition(r)}
                    </TableCell>

                    </TableCell>
                    <TableCell>
                      <ScopeText
                        rule={r}
                        tourMap={tourMap}
                        customerNames={customerNames}
                        productNames={productNames}
                      />
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.valid_until ? (
                        <>
                          {formatDateLong(r.valid_from)} —{" "}
                          {formatDateLong(r.valid_until)}
                        </>
                      ) : (
                        <>Fra {formatDateLong(r.valid_from)}</>
                      )}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(r)}
                        className="h-7 w-7 p-0"
                        aria-label="Rediger regel"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openDuplicate(r)}
                        className="h-7 w-7 p-0"
                        aria-label="Lag kopi av regel"
                        title="Lag kopi"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleActive(r)}
                        className="h-7 px-2 text-xs"
                        title={r.is_active ? "Deaktiver" : "Aktiver"}
                      >
                        {r.is_active ? "Deaktiver" : "Aktiver"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(r)}
                        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                        aria-label="Slett regel"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>

                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
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

          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
