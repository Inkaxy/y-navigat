import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";

type PosCustomer = {
  id: string;
  source_customer_id: string | null;
  display_name: string;
  phone: string | null;
  email: string | null;
  org_number: string | null;
  status: string;
  last_synced_at: string | null;
  default_invoice_method: string | null;
  credit_limit: number | null;
};

export default function PosKunder() {
  const { activeEntityId } = useLegalEntity();
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ["pos-customers", activeEntityId],
    enabled: !!activeEntityId,
    queryFn: async (): Promise<PosCustomer[]> => {
      const { data, error } = await supabase
        .from("pos_customers")
        .select(
          "id, source_customer_id, display_name, phone, email, org_number, status, last_synced_at, default_invoice_method, credit_limit",
        )
        .eq("legal_entity_id", activeEntityId!)
        .order("display_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PosCustomer[];
    },
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.filter((c) => {
      if (!showInactive && c.status !== "active") return false;
      if (!needle) return true;
      return (
        c.display_name?.toLowerCase().includes(needle) ||
        c.phone?.toLowerCase().includes(needle) ||
        c.email?.toLowerCase().includes(needle) ||
        c.org_number?.toLowerCase().includes(needle)
      );
    });
  }, [data, q, showInactive]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">POS-kunder</h1>
          <p className="text-sm text-muted-foreground">
            Kunder som kan handle på regning i kassa. Aktiveres fra kundekortet i Kunder-appen.
          </p>
        </div>
        <Button className="gap-2" disabled>
          <Plus className="h-4 w-4" />
          Ny POS-kunde
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Søk navn, telefon, e-post, org.nr…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button
          variant={showInactive ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? "Skjul inaktive" : "Vis inaktive"}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} av {data.length}
        </span>
      </div>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Laster…</div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm font-medium text-foreground">Ingen POS-kunder ennå</p>
            <p className="text-xs text-muted-foreground">
              Aktiver «Overfør til POS» på et kundekort i Kunder-appen for å synce hit.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Navn</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>E-post</TableHead>
                <TableHead>Org.nr</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sist synket</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.display_name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.org_number ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "active" ? "default" : "secondary"}>
                      {c.status === "active" ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.last_synced_at
                      ? formatDistanceToNow(new Date(c.last_synced_at), {
                          addSuffix: true,
                          locale: nb,
                        })
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
