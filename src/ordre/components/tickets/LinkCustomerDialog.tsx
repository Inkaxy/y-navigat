// Kobler en ukjent avsender-e-post til en kunde som allerede finnes i
// registeret. Vi endrer ALDRI kundens primære e-post — i stedet lagres
// avsenderen som en kontaktperson, som er det oppslaget i ticket-kortet
// faktisk slår opp mot. Da treffer også framtidige henvendelser riktig kunde.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";

type CustomerHit = {
  id: string;
  customer_number: string;
  display_name: string;
  primary_contact_email: string | null;
};

export default function LinkCustomerDialog({
  open,
  onOpenChange,
  senderEmail,
  senderName,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  senderEmail: string;
  senderName?: string | null;
  onLinked: (customerId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const [saving, setSaving] = useState(false);

  const { data: hits = [], isLoading } = useQuery({
    enabled: open,
    queryKey: ["ticket-link-customer-search", debounced],
    queryFn: async (): Promise<CustomerHit[]> => {
      let q = supabase
        .from("customers")
        .select("id, customer_number, display_name, primary_contact_email")
        .order("display_name")
        .limit(25);
      const term = debounced.trim();
      if (term) {
        q = q.or(
          `display_name.ilike.%${term}%,customer_number.ilike.%${term}%,primary_contact_email.ilike.%${term}%`,
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CustomerHit[];
    },
  });

  const link = async (c: CustomerHit) => {
    setSaving(true);
    try {
      // Finnes kontakten allerede? Da er koblingen bare å bekrefte.
      const { data: existing } = await supabase
        .from("customer_contacts")
        .select("id")
        .eq("customer_id", c.id)
        .ilike("email", senderEmail)
        .limit(1);

      if (!existing?.length) {
        const { error } = await supabase.from("customer_contacts").insert({
          customer_id: c.id,
          name: (senderName ?? senderEmail).trim(),
          email: senderEmail,
          role: "E-post",
          is_active: true,
        });
        if (error) throw error;
      }
      toast.success(`Koblet til ${c.display_name}`);
      onLinked(c.id);
      onOpenChange(false);
    } catch (e) {
      toast.error("Kobling feilet", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>Koble til eksisterende kunde</DialogTitle>
          <DialogDescription>
            {senderEmail} lagres som kontaktperson hos kunden du velger.
          </DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Søk navn, kundenr. eller e-post …"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{isLoading ? "Laster …" : "Ingen kunder funnet"}</CommandEmpty>
            <CommandGroup>
              {hits.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  disabled={saving}
                  onSelect={() => void link(c)}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{c.display_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.customer_number}
                        {c.primary_contact_email ? ` · ${c.primary_contact_email}` : ""}
                      </div>
                    </div>
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
