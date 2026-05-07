import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, ListChecks, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppBanner } from "@/components/shell/AppBanner";
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
import { NB_LEGAL_ENTITY_ID } from "@/lib/constants";
import { formatDateLong } from "@/lib/format";
import { logAudit } from "@/lib/audit";
import {
  useDeliveryRules,
  formatDeadlineDefinition,
  WEEKDAY_LABELS_LONG,
  type DeliveryRule,
  type DeliveryRuleFilter,
} from "@/hooks/useDeliveryRules";
import { useDeliveryTours, sortToursByPriority } from "@/hooks/useDeliveryTours";
import { useQuery } from "@tanstack/react-query";
import { DeliveryRuleFormDialog } from "@/components/orders/DeliveryRuleFormDialog";

function RuleTypeBadge({ type }: { type: DeliveryRule["rule_type"] }) {
  if (type === "order_deadline") {
    return (
      <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
        Ordrefrist
      </span>
    );
  }
  return null;
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

  const { data: rules = [], isLoading } = useDeliveryRules({ search, status });

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
  const [deleting, setDeleting] = useState<DeliveryRule | null>(null);
  const [busy, setBusy] = useState(false);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(r: DeliveryRule) {
    setEditing(r);
    setFormOpen(true);
  }

  async function handleSoftDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("delivery_rules")
        .update({ is_active: false })
        .eq("id", deleting.id);
      if (error) throw error;
      await logAudit({
        action: "deactivated",
        entity_type: "delivery_rule",
        entity_id: deleting.id,
        entity_display_reference: deleting.name,
        legal_entity_id: NB_LEGAL_ENTITY_ID,
      });
      toast.success("Regel deaktivert");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["delivery-rules"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunne ikke deaktivere regel");
    } finally {
      setBusy(false);
    }
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
          <Select disabled value="order_deadline">
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="order_deadline">Ordrefrist</SelectItem>
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
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDeadlineDefinition(r.deadline_time, r.deadline_days_before)}
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
                      {r.is_active && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleting(r)}
                          className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                          aria-label="Deaktiver regel"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
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
        onSaved={refresh}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deaktiver «{deleting?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Regelen vil ikke lenger evalueres for nye ordre. Du kan reaktivere
              regelen senere via Inaktive-filteret. Dette er en myk sletting —
              historiske regel-data bevares.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleSoftDelete} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Deaktiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
