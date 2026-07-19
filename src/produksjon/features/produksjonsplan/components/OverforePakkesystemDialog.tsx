import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Save, Download, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useSelection } from "@/providers/SelectionProvider";
import type { ProduksjonsplanCriteria } from "../types";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

function criteriaToQuery(c: ProduksjonsplanCriteria): string {
  const qs = new URLSearchParams();
  if (c.tour_numbers?.length) qs.set("tours", c.tour_numbers.join(","));
  if (c.main_category_ids?.length) qs.set("main_categories", c.main_category_ids.join(","));
  if (c.sub_category_ids?.length) qs.set("sub_categories", c.sub_category_ids.join(","));
  if (c.include_products_without_subcategory === false) qs.set("include_no_sub", "0");
  if (c.customer_group_ids?.length) qs.set("customer_groups", c.customer_group_ids.join(","));
  const s = qs.toString();
  return s ? `&${s}` : "";
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  date: string; // yyyy-MM-dd
  criteria: ProduksjonsplanCriteria;
  summary: string;
}

export function OverforePakkesystemDialog({ open, onOpenChange, date, criteria, summary }: Props) {
  const navigate = useNavigate();
  const { legalEntityId } = useSelection();

  const download = async () => {
    if (!legalEntityId) return toast({ title: "Mangler selskap", variant: "destructive" });
    const { data: sess } = await supabase.auth.getSession();
    const jwt = sess.session?.access_token;
    if (!jwt) return toast({ title: "Ingen session", variant: "destructive" });
    const res = await fetch(
      `${FUNCTIONS_BASE}/pakkesystem-export?date=${date}&legal_entity_id=${legalEntityId}${criteriaToQuery(criteria)}`,
      { headers: { Authorization: `Bearer ${jwt}` } },
    );
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (res.status === 409 && j?.code === "packing_slips_not_generated") {
          return toast({
            title: "Pakksedler mangler",
            description: `Kjør pakkseddel-generering for ${date} før pakkefilen kan lastes ned.`,
            variant: "destructive",
          });
        }
        msg = j?.error ?? msg;
      } catch {
        msg = (await res.text()).slice(0, 200) || msg;
      }
      return toast({ title: "Nedlasting feilet", description: msg, variant: "destructive" });
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pakkefil-${date}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ title: "Pakkefil lastet ned" });
  };

  const save = () => {
    try {
      localStorage.setItem("pakkesystem.lastCriteria", JSON.stringify(criteria));
      toast({ title: "Kriteriene lagret" });
    } catch {
      toast({ title: "Kunne ikke lagre", variant: "destructive" });
    }
  };

  const overfor = () => {
    onOpenChange(false);
    navigate("/produksjon/pakkesystem");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Overføre til Pakkesystem</DialogTitle>
        </DialogHeader>
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <pre className="text-xs font-mono leading-snug whitespace-pre-wrap">{summary}</pre>
        </div>
        <p className="text-xs text-muted-foreground">
          Filen genereres først når pakksedler for {date} er kjørt.
        </p>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="default" onClick={save} className="gap-2">
            <Save className="h-4 w-4" /> Lagre
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Lukk</Button>
            <Button variant="default" onClick={overfor} className="gap-2 bg-green-700 hover:bg-green-800 text-white">
              <Send className="h-4 w-4" /> Overføre
            </Button>
            <Button onClick={download} className="gap-2 bg-green-700 hover:bg-green-800 text-white">
              <Download className="h-4 w-4" /> Last ned
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
