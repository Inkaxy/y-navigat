import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  type CustomerGroup,
  useCustomerGroupMembers,
  useSetGroupMembers,
  useUpsertCustomerGroup,
} from "@/kunder/hooks/useCustomerGroups";
import { useCustomers } from "@/kunder/hooks/useCustomers";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  legalEntityId: string;
  group: CustomerGroup | null;
}

const COLOR_PRESETS = [
  "#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#6b7280",
];

function usePriceLists(legalEntityId: string | null | undefined) {
  return useQuery({
    queryKey: ["price-lists", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select("id, display_name, status")
        .eq("legal_entity_id", legalEntityId!)
        .order("display_name");
      if (error) throw error;
      return ((data ?? []) as any[]).filter((p) => p.status === "active");
    },
  });
}

export function CustomerGroupEditor({ open, onOpenChange, legalEntityId, group }: Props) {
  const isEdit = !!group;
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(COLOR_PRESETS[0]);
  const [priceListId, setPriceListId] = useState<string>("none");
  const [sortOrder, setSortOrder] = useState<string>("0");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [tab, setTab] = useState<"info" | "members">("info");
  const [memberSearch, setMemberSearch] = useState("");
  const debouncedSearch = useDebouncedValue(memberSearch, 250);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    if (group) {
      setCode(group.code);
      setDisplayName(group.display_name);
      setDescription(group.description ?? "");
      setColor(group.color_hex ?? COLOR_PRESETS[0]);
      setPriceListId(group.default_price_list_id ?? "none");
      setSortOrder(String(group.sort_order));
      setStatus(group.status);
    } else {
      setCode("");
      setDisplayName("");
      setDescription("");
      setColor(COLOR_PRESETS[0]);
      setPriceListId("none");
      setSortOrder("0");
      setStatus("active");
    }
    setTab("info");
    setMemberSearch("");
  }, [group, open]);

  const { data: priceLists } = usePriceLists(legalEntityId);
  const { data: customers } = useCustomers(legalEntityId, { search: debouncedSearch });
  const { data: existingMembers } = useCustomerGroupMembers(group?.id ?? null);

  useEffect(() => {
    if (!existingMembers) return;
    setSelectedMembers(new Set(existingMembers.map((m) => m.customer_id)));
  }, [existingMembers]);

  const upsert = useUpsertCustomerGroup();
  const setMembers = useSetGroupMembers();

  const inheritCount = useMemo(() => {
    if (!existingMembers || priceListId === "none") return 0;
    return existingMembers.filter((m) => !m.default_price_list_id).length;
  }, [existingMembers, priceListId]);

  const handleSave = async () => {
    if (!code.trim() || !displayName.trim()) {
      toast.error("Kode og navn er påkrevd");
      return;
    }
    try {
      const result = await upsert.mutateAsync({
        id: group?.id,
        legal_entity_id: legalEntityId,
        code: code.trim(),
        display_name: displayName.trim(),
        description: description.trim() || null,
        color_hex: color,
        default_price_list_id: priceListId === "none" ? null : priceListId,
        sort_order: parseInt(sortOrder, 10) || 0,
        status,
      });
      const newId = (result as any).id ?? group?.id;
      if (newId && isEdit) {
        await setMembers.mutateAsync({
          group_id: newId,
          legal_entity_id: legalEntityId,
          group_label: `${code} — ${displayName}`,
          next_customer_ids: Array.from(selectedMembers),
        });
      } else if (newId && selectedMembers.size > 0) {
        await setMembers.mutateAsync({
          group_id: newId,
          legal_entity_id: legalEntityId,
          group_label: `${code} — ${displayName}`,
          next_customer_ids: Array.from(selectedMembers),
        });
      }
      toast.success(isEdit ? "Gruppe oppdatert" : "Gruppe opprettet");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke lagre gruppe");
    }
  };

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeSelected = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const selectedRows = useMemo(() => {
    const map = new Map<string, { id: string; display_name: string; customer_number: string | null }>();
    for (const m of existingMembers ?? []) {
      if (selectedMembers.has(m.customer_id)) {
        map.set(m.customer_id, {
          id: m.customer_id,
          display_name: m.display_name,
          customer_number: m.customer_number,
        });
      }
    }
    for (const c of customers ?? []) {
      if (selectedMembers.has(c.id) && !map.has(c.id)) {
        map.set(c.id, { id: c.id, display_name: c.display_name, customer_number: c.customer_number ?? null });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [selectedMembers, existingMembers, customers]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rediger kundegruppe" : "Ny kundegruppe"}</DialogTitle>
          <DialogDescription>
            Grupper kunder for prising og rapportering. Default prisliste arves til kunder uten egen.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="info">Detaljer</TabsTrigger>
            <TabsTrigger value="members">
              Medlemmer
              <Badge variant="secondary" className="ml-2">
                {selectedMembers.size}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cg-code">Kode *</Label>
                <Input
                  id="cg-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="kafe-vip"
                />
              </div>
              <div>
                <Label htmlFor="cg-name">Visningsnavn *</Label>
                <Input
                  id="cg-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Kafé VIP"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="cg-desc">Beskrivelse</Label>
              <Textarea
                id="cg-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Farge</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`h-7 w-7 rounded-full border-2 transition ${
                        color === c ? "border-foreground scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`Farge ${c}`}
                    />
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="cg-sort">Sortering</Label>
                <Input
                  id="cg-sort"
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Default prisliste</Label>
                <Select value={priceListId} onValueChange={setPriceListId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Ingen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ingen</SelectItem>
                    {(priceLists ?? []).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {priceListId !== "none" && existingMembers && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {inheritCount} av {existingMembers.length} medlemmer arver denne prislisten
                    (resten har egen).
                  </p>
                )}
              </div>
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktiv</SelectItem>
                    <SelectItem value="archived">Arkivert</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="members" className="mt-4 space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Søk etter kunder…"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {selectedRows.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-2">
                <p className="mb-1 px-1 text-xs font-medium text-muted-foreground">
                  Valgte medlemmer ({selectedRows.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedRows.map((r) => (
                    <Badge
                      key={r.id}
                      variant="secondary"
                      className="cursor-pointer gap-1"
                      onClick={() => removeSelected(r.id)}
                    >
                      {r.display_name}
                      <X className="h-3 w-3" />
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              {(customers ?? []).length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Ingen kunder funnet</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(customers ?? []).slice(0, 100).map((c) => (
                    <li
                      key={c.id}
                      className="flex cursor-pointer items-center gap-3 p-2 hover:bg-accent/40"
                      onClick={() => toggleMember(c.id)}
                    >
                      <Checkbox
                        checked={selectedMembers.has(c.id)}
                        onCheckedChange={() => toggleMember(c.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{c.display_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.customer_number} {c.default_price_list_id ? "· egen prisliste" : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={handleSave} disabled={upsert.isPending || setMembers.isPending}>
            {(upsert.isPending || setMembers.isPending) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {isEdit ? "Lagre" : "Opprett"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
