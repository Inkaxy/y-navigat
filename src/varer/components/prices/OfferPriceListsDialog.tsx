/**
 * Modal for å administrere TILBUDS-prislister (price_list_type = 'offer').
 * Base-prislister (Engros, Utsalg) vises og redigeres ikke her — beskyttet i DB-trigger.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/lib/constants";
import { logAudit } from "@/lib/audit";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

type OfferRow = {
  id: string | null; // null = ny
  list_number: string;
  display_name: string;
  prevNumber?: number | null;
  prevName?: string;
  toDelete?: boolean;
};

function slugifyCode(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\d+\s+/, "") // fjern ledende nummer
    .replace(/[æø]/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function OfferPriceListsDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<OfferRow[]>([]);
  const [saving, setSaving] = useState(false);

  const listsQuery = useQuery({
    queryKey: ["offer-price-lists", NB_LEGAL_ENTITY_ID],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_lists")
        .select("id, display_name, list_number, price_list_type, status")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("price_list_type", "offer")
        .eq("status", "active")
        .order("list_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Last inn rader fra query
  useEffect(() => {
    if (!open || !listsQuery.data) return;
    setRows([
      ...listsQuery.data.map((l) => ({
        id: l.id,
        list_number: l.list_number != null ? String(l.list_number) : "",
        display_name: stripLeadingNumber(l.display_name),
        prevNumber: l.list_number,
        prevName: l.display_name,
      })),
      blankRow(),
    ]);
  }, [open, listsQuery.data]);

  function blankRow(): OfferRow {
    return { id: null, list_number: "", display_name: "" };
  }

  function updateRow(idx: number, patch: Partial<OfferRow>) {
    setRows((rs) => {
      const next = rs.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      // Sørg for at det alltid er én tom rad nederst
      const last = next[next.length - 1];
      if (last && (last.list_number || last.display_name) && !last.toDelete) {
        next.push(blankRow());
      }
      return next;
    });
  }

  function markDelete(idx: number) {
    setRows((rs) =>
      rs.map((r, i) =>
        i === idx ? (r.id ? { ...r, toDelete: true } : { ...r, list_number: "", display_name: "" }) : r,
      ),
    );
  }

  function undoDelete(idx: number) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, toDelete: false } : r)));
  }

  async function save() {
    setSaving(true);
    try {
      // Validering
      const numbers = new Set<number>();
      for (const r of rows) {
        if (r.toDelete) continue;
        if (!r.list_number && !r.display_name) continue;
        if (!r.list_number || !r.display_name) {
          toast.error("Alle rader må ha både nummer og navn");
          setSaving(false);
          return;
        }
        const n = Number(r.list_number);
        if (!Number.isInteger(n) || n < 1 || n > 99) {
          toast.error(`Nummer må være 1-99 (fant ${r.list_number})`);
          setSaving(false);
          return;
        }
        if (numbers.has(n)) {
          toast.error(`Duplikat nummer: ${n}`);
          setSaving(false);
          return;
        }
        numbers.add(n);
      }

      let changes = 0;

      // Slettinger (status='archived')
      for (const r of rows) {
        if (r.toDelete && r.id) {
          const { error } = await supabase
            .from("price_lists")
            .update({ status: "archived", list_number: null })
            .eq("id", r.id);
          if (error) {
            toast.error(`Kunne ikke arkivere: ${error.message}`);
            continue;
          }
          await logAudit({
            action: "delete",
            entity_type: "price_list",
            entity_id: r.id,
            entity_display_reference: r.prevName ?? "",
            changes: { archived: true },
          });
          changes++;
        }
      }

      // Oppdateringer + nye
      for (const r of rows) {
        if (r.toDelete) continue;
        if (!r.list_number || !r.display_name) continue;
        const num = Number(r.list_number);
        const fullName = `${num} ${r.display_name.trim()}`;

        if (r.id) {
          // Update — bare hvis endret
          if (num === r.prevNumber && fullName === r.prevName) continue;
          const { error } = await supabase
            .from("price_lists")
            .update({ list_number: num, display_name: fullName })
            .eq("id", r.id);
          if (error) {
            toast.error(`${fullName}: ${error.message}`);
            continue;
          }
          await logAudit({
            action: "update",
            entity_type: "price_list",
            entity_id: r.id,
            entity_display_reference: fullName,
            changes: { list_number: num, display_name: fullName },
          });
          changes++;
        } else {
          // Insert ny
          const code = slugifyCode(r.display_name) || `prisliste_${num}`;
          const { data, error } = await supabase
            .from("price_lists")
            .insert({
              legal_entity_id: NB_LEGAL_ENTITY_ID,
              code,
              display_name: fullName,
              list_number: num,
              price_list_type: "offer",
              prices_include_mva: false,
              is_default: false,
              status: "active",
            })
            .select("id")
            .single();
          if (error) {
            toast.error(`${fullName}: ${error.message}`);
            continue;
          }
          await logAudit({
            action: "create",
            entity_type: "price_list",
            entity_id: data.id,
            entity_display_reference: fullName,
            changes: { list_number: num, code },
          });
          changes++;
        }
      }

      if (changes > 0) {
        toast.success(`${changes} endring(er) lagret`);
        qc.invalidateQueries({ queryKey: ["price-lists-full"] });
        qc.invalidateQueries({ queryKey: ["offer-price-lists"] });
        onOpenChange(false);
      } else {
        toast.info("Ingen endringer å lagre");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Tilbudsprislister</DialogTitle>
          <DialogDescription>
            Administrer tilbudsprislister. Base-prislister (Engros, Utsalg) vises ikke her og kan ikke
            slettes.
          </DialogDescription>
        </DialogHeader>

        {listsQuery.isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[80px_1fr_auto] gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <div>Nummer</div>
              <div>Navn</div>
              <div className="w-9" />
            </div>
            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {rows.map((r, idx) => (
                <div
                  key={r.id ?? `new-${idx}`}
                  className={
                    "grid grid-cols-[80px_1fr_auto] items-center gap-2 " +
                    (r.toDelete ? "opacity-40 line-through" : "")
                  }
                >
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={r.list_number}
                    onChange={(e) => updateRow(idx, { list_number: e.target.value })}
                    disabled={r.toDelete}
                    className="h-9"
                    placeholder=""
                  />
                  <Input
                    value={r.display_name}
                    onChange={(e) => updateRow(idx, { display_name: e.target.value })}
                    disabled={r.toDelete}
                    className="h-9"
                    placeholder={idx === rows.length - 1 ? "Ny prisliste…" : ""}
                  />
                  {r.toDelete ? (
                    <Button variant="ghost" size="sm" onClick={() => undoDelete(idx)}>
                      Angre
                    </Button>
                  ) : r.id ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => markDelete(idx)}
                      title="Arkiver"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center text-muted-foreground">
                      <Plus className="h-4 w-4" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Tomme rader nederst opprettes automatisk når du fyller dem ut. Sletting setter prislisten
              som arkivert; historiske priser bevares.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Ferdig
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-app hover:bg-app-dark text-app-foreground"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function stripLeadingNumber(s: string): string {
  return s.replace(/^\d+\s+/, "");
}
