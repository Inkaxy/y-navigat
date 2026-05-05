import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";

export type NewProfileSeed = {
  id: string;
  code: string;
  display_name: string;
  legal_entity_id: string;
};

/**
 * Slugify et navn til en gyldig price_list-kode.
 * Regler (avtalt C.6):
 *   æ→ae, ø→oe, å→aa
 *   mellomrom/bindestrek → _
 *   fjern alt utenom [a-z0-9_]
 *   lowercase
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
  /** Kalt etter både "Opprett" (suksess) og "Hopp over". */
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && profile) {
      setDisplayName(profile.display_name);
      setCode(slugifyCode(profile.display_name));
      setCodeEdited(false);
      setError(null);
    }
  }, [open, profile]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Mangler profil");
      const trimmedName = displayName.trim();
      const trimmedCode = code.trim();
      if (!trimmedName) throw new Error("Navn kan ikke være tomt");
      if (!CODE_RE.test(trimmedCode)) {
        throw new Error("Kode må kun inneholde a-z, 0-9 og _");
      }

      // Sjekk duplikat-kode innen legal_entity (defensiv — DB har trolig unique-constraint)
      const { data: dupe, error: dupeErr } = await supabase
        .from("price_lists")
        .select("id")
        .eq("legal_entity_id", profile.legal_entity_id)
        .eq("code", trimmedCode)
        .maybeSingle();
      if (dupeErr) throw dupeErr;
      if (dupe) throw new Error("__DUPLICATE__");

      // Beregn next list_number.
      // NOTE: Race-condition mulig ved samtidige opprettelser (lav sannsynlighet hos NB).
      // Hvis det blir et problem: flytt til RPC med advisory lock.
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

      return { priceList, profile };
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

  function handleSkip() {
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !mutation.isPending) {
          // Lukking via X / overlay = hopp over
          onOpenChange(false);
          onDone();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Opprett tilhørende prisliste for {profile?.display_name ?? ""}?
          </DialogTitle>
          <DialogDescription>
            Du kan opprette en ny prisliste som er koblet til denne profilen.
            Kunder med denne profilen vil kunne tilbys den nye prislisten. Du
            kan også hoppe over og koble prislister til profilen senere.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleSkip}
            disabled={mutation.isPending}
          >
            Hopp over
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !displayName.trim() || !code.trim()}
          >
            {mutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Opprett prisliste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
