import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/kunder/lib/audit";

export type NewProfileSeed = {
  id: string;
  code: string;
  display_name: string;
  legal_entity_id: string;
};

/**
 * Slugify et navn til en gyldig price_list-kode.
 * æ→ae, ø→oe, å→aa; mellomrom/bindestrek → _; fjern alt utenom [a-z0-9_]; lowercase.
 */
export function slugifyCode(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const CODE_RE = /^[a-z0-9_]+$/;

export function CreatePriceListPrompt({
  open,
  onOpenChange,
  profile,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profile: NewProfileSeed | null;
  /** Kalt etter både "Opprett"/"Koble" (suksess) og "Hopp over". */
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"new" | "existing">("new");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedExistingId, setSelectedExistingId] = useState<string>("");

  useEffect(() => {
    if (open && profile) {
      setTab("new");
      setDisplayName(profile.display_name);
      setCode(slugifyCode(profile.display_name));
      setCodeEdited(false);
      setError(null);
      setSelectedExistingId("");
    }
  }, [open, profile]);

  // Eksisterende aktive prislister + hvilke som allerede er koblet til profilen
  const existingQuery = useQuery({
    queryKey: ["price-lists-for-profile", profile?.legal_entity_id, profile?.id],
    enabled: !!profile && open,
    queryFn: async () => {
      const [listsRes, linkedRes] = await Promise.all([
        supabase
          .from("price_lists")
          .select("id, code, display_name, status")
          .eq("legal_entity_id", profile!.legal_entity_id)
          .eq("status", "active")
          .order("display_name"),
        supabase
          .from("customer_profile_price_lists")
          .select("price_list_id")
          .eq("customer_profile_id", profile!.id),
      ]);
      if (listsRes.error) throw listsRes.error;
      if (linkedRes.error) throw linkedRes.error;
      const linkedIds = new Set(((linkedRes.data ?? []) as any[]).map((r) => r.price_list_id));
      return ((listsRes.data ?? []) as any[]).map((p) => ({
        ...p,
        already_linked: linkedIds.has(p.id),
      }));
    },
  });

  const availableExisting = useMemo(
    () => (existingQuery.data ?? []).filter((p: any) => !p.already_linked),
    [existingQuery.data],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Mangler profil");
      const trimmedName = displayName.trim();
      const trimmedCode = code.trim();
      if (!trimmedName) throw new Error("Navn kan ikke være tomt");
      if (!CODE_RE.test(trimmedCode)) {
        throw new Error("Kode må kun inneholde a-z, 0-9 og _");
      }

      const { data: dupe, error: dupeErr } = await supabase
        .from("price_lists")
        .select("id")
        .eq("legal_entity_id", profile.legal_entity_id)
        .eq("code", trimmedCode)
        .maybeSingle();
      if (dupeErr) throw dupeErr;
      if (dupe) throw new Error("__DUPLICATE__");

      const { data: maxRows, error: maxErr } = await supabase
        .from("price_lists")
        .select("list_number")
        .eq("legal_entity_id", profile.legal_entity_id)
        .not("list_number", "is", null)
        .order("list_number", { ascending: false })
        .limit(1);
      if (maxErr) throw maxErr;
      const nextListNumber = (maxRows?.[0]?.list_number ?? 0) + 1;

      const { data: priceList, error: plErr } = await supabase
        .from("price_lists")
        .insert({
          legal_entity_id: profile.legal_entity_id,
          code: trimmedCode,
          display_name: trimmedName,
          price_list_type: "offer",
          list_number: nextListNumber,
          status: "active",
        })
        .select("id, code, display_name")
        .single();
      if (plErr) {
        if (
          plErr.message?.toLowerCase().includes("duplicate") ||
          plErr.message?.toLowerCase().includes("unique")
        ) {
          throw new Error("__DUPLICATE__");
        }
        throw plErr;
      }

      const { error: jErr } = await supabase
        .from("customer_profile_price_lists")
        .insert({
          customer_profile_id: profile.id,
          price_list_id: priceList.id,
          sort_order: 0,
        });
      if (jErr) throw jErr;

      await logAudit({
        action: "price_list.created_from_profile",
        entity_type: "price_list",
        entity_id: priceList.id,
        entity_display_reference: `${priceList.code} — ${priceList.display_name}`,
        legal_entity_id: profile.legal_entity_id,
        changes: {
          customer_profile_id: profile.id,
          price_list_type: "offer",
          list_number: nextListNumber,
        },
      });

      return { priceList, profile, mode: "new" as const };
    },
    onSuccess: ({ priceList, profile }) => {
      queryClient.invalidateQueries({ queryKey: ["price-lists"] });
      queryClient.invalidateQueries({
        queryKey: ["customer-profile-price-lists", profile.id],
      });
      toast.success(
        `Prisliste '${priceList.display_name}' opprettet og koblet til profil '${profile.display_name}'`,
      );
      onOpenChange(false);
      onDone();
    },
    onError: (e: any) => {
      if (e?.message === "__DUPLICATE__") {
        setError("En prisliste med denne koden finnes allerede");
      } else {
        toast.error(`Kunne ikke opprette prisliste: ${e?.message ?? "Ukjent feil"}`);
      }
    },
  });

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Mangler profil");
      if (!selectedExistingId) throw new Error("Velg en prisliste");
      const picked = (existingQuery.data ?? []).find((p: any) => p.id === selectedExistingId);
      if (!picked) throw new Error("Prisliste ikke funnet");

      const { error: jErr } = await supabase.from("customer_profile_price_lists").insert({
        customer_profile_id: profile.id,
        price_list_id: selectedExistingId,
        sort_order: 0,
      });
      if (jErr) throw jErr;

      await logAudit({
        action: "price_list.linked_to_profile",
        entity_type: "price_list",
        entity_id: selectedExistingId,
        entity_display_reference: `${picked.code} — ${picked.display_name}`,
        legal_entity_id: profile.legal_entity_id,
        changes: { customer_profile_id: profile.id },
      });
      return { picked, profile };
    },
    onSuccess: ({ picked, profile }) => {
      queryClient.invalidateQueries({
        queryKey: ["customer-profile-price-lists", profile.id],
      });
      toast.success(
        `Prisliste '${picked.display_name}' koblet til profil '${profile.display_name}'`,
      );
      onOpenChange(false);
      onDone();
    },
    onError: (e: any) => {
      toast.error(`Kunne ikke koble prisliste: ${e?.message ?? "Ukjent feil"}`);
    },
  });

  const isPending = createMutation.isPending || linkMutation.isPending;

  function handleSkip() {
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !isPending) {
          onOpenChange(false);
          onDone();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Koble prisliste til {profile?.display_name ?? ""}?
          </DialogTitle>
          <DialogDescription>
            Opprett en ny prisliste, eller velg en eksisterende. Du kan også
            hoppe over og koble prislister til profilen senere.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="new">Opprett ny</TabsTrigger>
            <TabsTrigger value="existing">Velg eksisterende</TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pl-name">Navn på prisliste *</Label>
              <Input
                id="pl-name"
                value={displayName}
                onChange={(e) => {
                  const v = e.target.value;
                  setDisplayName(v);
                  if (!codeEdited) setCode(slugifyCode(v));
                  setError(null);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pl-code">Kode *</Label>
              <Input
                id="pl-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setCodeEdited(true);
                  setError(null);
                }}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Maskinlesbar identifikator. Kan ikke endres senere.
              </p>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          </TabsContent>

          <TabsContent value="existing" className="mt-4 space-y-3">
            {existingQuery.isLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Henter prislister…
              </div>
            ) : availableExisting.length === 0 ? (
              <p className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                Ingen tilgjengelige prislister å koble til. Alle aktive prislister er
                allerede koblet til denne profilen, eller ingen finnes ennå.
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label>Prisliste *</Label>
                <Select value={selectedExistingId} onValueChange={setSelectedExistingId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Velg en prisliste…" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableExisting.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.display_name}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {p.code}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Kun aktive prislister som ikke allerede er koblet til profilen vises.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleSkip} disabled={isPending}>
            Hopp over
          </Button>
          {tab === "new" ? (
            <Button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={isPending || !displayName.trim() || !code.trim()}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Opprett prisliste
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => linkMutation.mutate()}
              disabled={isPending || !selectedExistingId}
            >
              {linkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Koble prisliste
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
