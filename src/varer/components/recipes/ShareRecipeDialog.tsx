import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Check, Copy, Eye, Link2, Loader2, Plus, Ban } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeId: string;
  recipeName: string;
  canWrite: boolean;
}

const EXPIRY_OPTIONS = [
  { value: "never", label: "Aldri" },
  { value: "7", label: "7 dager" },
  { value: "30", label: "30 dager" },
  { value: "90", label: "90 dager" },
];

export function shareUrlFor(token: string) {
  return `${window.location.origin}/oppskrift/${token}`;
}

function newToken() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}

export function ShareRecipeDialog({ open, onOpenChange, recipeId, recipeName, canWrite }: Props) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("30");
  const [includeCosts, setIncludeCosts] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const linksQuery = useQuery({
    queryKey: ["recipe-share-links", recipeId],
    enabled: open && !!recipeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_share_links")
        .select("id, token, label, include_costs, expires_at, revoked_at, view_count, last_viewed_at, created_at")
        .eq("recipe_id", recipeId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const createLink = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const expires_at =
        expiry === "never" ? null : new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000).toISOString();
      const token = newToken();
      const { error } = await supabase.from("recipe_share_links").insert({
        recipe_id: recipeId,
        token,
        label: label.trim() || null,
        include_costs: includeCosts,
        expires_at,
        created_by: userData.user?.id ?? null,
      } as never);
      if (error) throw error;
      return token;
    },
    onSuccess: async (token) => {
      setLabel("");
      setIncludeCosts(false);
      qc.invalidateQueries({ queryKey: ["recipe-share-links", recipeId] });
      qc.invalidateQueries({ queryKey: ["recipe-share-counts"] });
      try {
        await navigator.clipboard.writeText(shareUrlFor(token));
        toast.success("Delingslenke laget og kopiert");
      } catch {
        toast.success("Delingslenke laget");
      }
    },
    onError: (e: any) => toast.error(e.message ?? "Kunne ikke lage lenke"),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("recipe_share_links")
        .update({ revoked_at: new Date().toISOString() } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipe-share-links", recipeId] });
      qc.invalidateQueries({ queryKey: ["recipe-share-counts"] });
      toast.success("Lenken er trukket tilbake");
    },
    onError: (e: any) => toast.error(e.message ?? "Kunne ikke trekke tilbake"),
  });

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrlFor(token));
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1800);
    } catch {
      toast.error("Kunne ikke kopiere");
    }
  }

  function statusOf(l: any) {
    if (l.revoked_at) return { label: "Trukket tilbake", variant: "outline" as const, muted: true };
    if (l.expires_at && new Date(l.expires_at).getTime() < Date.now())
      return { label: "Utløpt", variant: "outline" as const, muted: true };
    return { label: "Aktiv", variant: "secondary" as const, muted: false };
  }

  const links = linksQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Del «{recipeName}»</DialogTitle>
          <DialogDescription>
            Den som får lenken ser oppskriften uten å logge inn, og kan skalere den til sitt eget antall.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {linksQuery.isLoading ? (
              <div className="flex h-20 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : links.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Ingen delingslenker ennå.</p>
            ) : (
              links.map((l) => {
                const st = statusOf(l);
                return (
                  <div
                    key={l.id}
                    className={`rounded-md border border-border px-3 py-2 ${st.muted ? "opacity-60" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{l.label || "Uten etikett"}</span>
                      <Badge variant={st.variant}>{st.label}</Badge>
                      {l.include_costs && <Badge variant="outline">Med kostpriser</Badge>}
                      <div className="flex-1" />
                      <Button variant="ghost" size="sm" onClick={() => copy(l.token)}>
                        {copied === l.token ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                      {canWrite && !l.revoked_at && (
                        <Button variant="ghost" size="sm" onClick={() => revoke.mutate(l.id)}>
                          <Ban className="mr-1 h-3.5 w-3.5" /> Trekk tilbake
                        </Button>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                      <span>Opprettet {fmtDate(l.created_at)}</span>
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3 w-3" /> {l.view_count ?? 0} visninger
                      </span>
                      <span>Sist sett {fmtDate(l.last_viewed_at)}</span>
                      <span>Utløper {l.expires_at ? fmtDate(l.expires_at) : "aldri"}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {canWrite && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Etikett</Label>
                    <Input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="f.eks. Kurs oktober"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Utløp</Label>
                    <select
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {EXPIRY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={includeCosts}
                    onCheckedChange={(v) => setIncludeCosts(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Ta med kostpriser
                    <span className="block text-xs text-muted-foreground">
                      Kostpriser vises normalt ikke i delte oppskrifter.
                    </span>
                  </span>
                </label>

                <Button onClick={() => createLink.mutate()} disabled={createLink.isPending}>
                  {createLink.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Lag ny lenke
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
