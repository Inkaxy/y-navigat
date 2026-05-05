import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { NB_LEGAL_ENTITY_ID } from "@/lib/constants";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";
import { useAppContext } from "@/context/AppContext";

export default function PriceListDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canWrite } = useAppContext();
  const [editing, setEditing] = useState<{ id: string; price: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ product_id: "", price: "" });

  const listQuery = useQuery({
    queryKey: ["price-list", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from("price_lists").select("*").eq("id", id!).single();
      return data;
    },
  });

  const itemsQuery = useQuery({
    queryKey: ["price-list-items", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("price_list_items")
        .select("id, price, valid_from, valid_to, product_id, products(id, display_name, code, display_number)")
        .eq("price_list_id", id!);
      return data ?? [];
    },
  });

  const productsQuery = useQuery({
    queryKey: ["products-min", NB_LEGAL_ENTITY_ID],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id, display_name, code")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("display_name");
      return data ?? [];
    },
  });

  const usedIds = useMemo(() => new Set((itemsQuery.data ?? []).map((i: any) => i.product_id)), [itemsQuery.data]);
  const availableProducts = (productsQuery.data ?? []).filter((p) => !usedIds.has(p.id));

  async function savePrice(itemId: string, newPrice: string, displayName: string) {
    const num = Number(newPrice);
    if (isNaN(num) || num < 0) { toast.error("Ugyldig pris"); return; }
    const { error } = await supabase.from("price_list_items").update({ price: num }).eq("id", itemId);
    if (error) { toast.error(error.message); return; }
    await logAudit({ action: "update", entity_type: "price_list_item", entity_id: itemId, entity_display_reference: displayName, changes: { price: num } });
    qc.invalidateQueries({ queryKey: ["price-list-items", id] });
    setEditing(null);
    toast.success("Pris oppdatert");
  }

  async function addItem() {
    if (!addForm.product_id || !addForm.price) return;
    const { data, error } = await supabase
      .from("price_list_items")
      .insert({ price_list_id: id!, product_id: addForm.product_id, price: Number(addForm.price) } as never)
      .select("id, products(display_name)").single();
    if (error) { toast.error(error.message); return; }
    await logAudit({
      action: "create",
      entity_type: "price_list_item",
      entity_id: data.id,
      entity_display_reference: (data as any).products?.display_name,
      changes: { price: Number(addForm.price) },
    });
    qc.invalidateQueries({ queryKey: ["price-list-items", id] });
    setAddOpen(false);
    setAddForm({ product_id: "", price: "" });
    toast.success("Vare lagt til");
  }

  async function removeItem(itemId: string, displayName: string) {
    const { error } = await supabase.from("price_list_items").delete().eq("id", itemId);
    if (error) { toast.error(error.message); return; }
    await logAudit({ action: "delete", entity_type: "price_list_item", entity_id: itemId, entity_display_reference: displayName });
    qc.invalidateQueries({ queryKey: ["price-list-items", id] });
    toast.success("Vare fjernet fra prisliste");
  }

  if (listQuery.isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const list = listQuery.data!;

  return (
    <div className="px-6 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/priser")} className="-ml-2 mb-3">
        <ArrowLeft className="mr-1 h-4 w-4" /> Tilbake til prislister
      </Button>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{list.display_name}</h1>
          <p className="text-sm text-muted-foreground font-mono">
            {list.code}
            {list.list_number != null && <> · nr {list.list_number}</>}
            {list.price_list_type === "base" && (
              <Badge className="ml-2 bg-muted text-muted-foreground">Base</Badge>
            )}
            {list.is_default && <Badge className="ml-2 bg-app/15 text-app-dark">Default</Badge>}
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setAddOpen(true)} className="bg-app hover:bg-app-dark text-app-foreground">
            <Plus className="mr-1.5 h-4 w-4" /> Legg til vare
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left">Vare</th>
              <th className="px-4 py-2.5 text-left">Kode</th>
              <th className="px-4 py-2.5 text-left">Gyldig fra</th>
              <th className="px-4 py-2.5 text-right">Pris</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {(itemsQuery.data ?? []).length === 0 && (
              <tr><td colSpan={5} className="py-12 text-center text-muted-foreground">Ingen varer i denne prislisten ennå.</td></tr>
            )}
            {(itemsQuery.data ?? []).map((it: any) => (
              <tr key={it.id} className="border-t border-border">
                <td className="px-4 py-2">{it.products?.display_name}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{it.products?.code}</td>
                <td className="px-4 py-2 text-muted-foreground">{it.valid_from}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {editing?.id === it.id ? (
                    <Input
                      autoFocus
                      type="number"
                      step="0.01"
                      value={editing.price}
                      onChange={(e) => setEditing({ id: it.id, price: e.target.value })}
                      onBlur={() => savePrice(it.id, editing.price, it.products?.display_name)}
                      onKeyDown={(e) => { if (e.key === "Enter") savePrice(it.id, editing.price, it.products?.display_name); if (e.key === "Escape") setEditing(null); }}
                      className="ml-auto w-28 text-right"
                    />
                  ) : (
                    <button
                      onClick={() => canWrite && setEditing({ id: it.id, price: String(it.price) })}
                      className={canWrite ? "rounded px-2 py-1 hover:bg-muted" : ""}
                      disabled={!canWrite}
                    >
                      kr {Number(it.price).toFixed(2)}
                    </button>
                  )}
                </td>
                <td>
                  {canWrite && (
                    <Button variant="ghost" size="icon" onClick={() => removeItem(it.id, it.products?.display_name)}>
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Legg vare til prislisten</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Vare</Label>
              <Select value={addForm.product_id} onValueChange={(v) => setAddForm({ ...addForm, product_id: v })}>
                <SelectTrigger><SelectValue placeholder="Velg vare…" /></SelectTrigger>
                <SelectContent>
                  {availableProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Pris</Label>
              <Input type="number" step="0.01" value={addForm.price} onChange={(e) => setAddForm({ ...addForm, price: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Avbryt</Button>
            <Button onClick={addItem} disabled={!addForm.product_id || !addForm.price} className="bg-app hover:bg-app-dark text-app-foreground">Legg til</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
