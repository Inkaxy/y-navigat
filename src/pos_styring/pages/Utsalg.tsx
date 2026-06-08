import { Store, Info, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useSelection } from "@/providers/SelectionProvider";
import { useAuth } from "@/hooks/useAuth";
import { useMyPositions } from "@/hooks/useMyPositions";
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";
import { cn } from "@/lib/utils";

interface OutletRow {
  id: string;
  legal_entity_id: string;
  display_number: number | null;
  short_name: string;
  full_name: string | null;
  outlet_type: string | null;
  status: string | null;
  city: string | null;
}

export default function Utsalg() {
  const { user } = useAuth();
  const { legalEntityId, outletId, setOutletId } = useSelection();
  const { activeEntity } = useLegalEntity();
  const { data: positions } = useMyPositions();

  const { data: outlets = [], isLoading } = useQuery({
    queryKey: ["pos-styring", "outlets", legalEntityId],
    enabled: !!user?.id && !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outlets")
        .select(
          "id, legal_entity_id, display_number, short_name, full_name, outlet_type, status, city",
        )
        .eq("legal_entity_id", legalEntityId!)
        .order("display_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OutletRow[];
    },
  });

  // Filtrer på posisjonenes outlet-scope (samme logikk som OutletSelector)
  const accessible = (() => {
    if (!outlets || !positions) return outlets;
    const entityPositions = (positions as any[]).filter(
      (p) => p.legal_entity?.id === legalEntityId,
    );
    if (entityPositions.length === 0) return [];
    const hasAll = entityPositions.some((p) => p.outlet_scope === "all");
    if (hasAll) return outlets;
    const allowedIds = new Set<string>(
      entityPositions.flatMap((p) => p.outlet_ids ?? []),
    );
    return outlets.filter((o) => allowedIds.has(o.id));
  })();

  const activeOutlet = accessible.find((o) => o.id === outletId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-app-pastel text-app-dark">
          <Store className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Utsalg</h1>
          <p className="text-sm text-muted-foreground">
            Velg hvilket utsalg POS Styring skal vise data for.{" "}
            {activeEntity && (
              <>
                Viser utsalg under{" "}
                <span className="font-medium text-foreground">
                  {activeEntity.short_code} — {activeEntity.legal_name}
                </span>
                .
              </>
            )}
          </p>
        </div>
      </div>

      <Card className="border-app-pastel-border bg-app-pastel/40 p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-app-dark">
          Aktivt utsalg
        </div>
        <div className="mt-1 text-lg font-semibold">
          {activeOutlet
            ? `#${activeOutlet.display_number ?? "—"} ${activeOutlet.short_name}`
            : isLoading
              ? "Laster…"
              : "Ikke valgt"}
        </div>
        {activeOutlet?.full_name && (
          <div className="text-xs text-muted-foreground">
            {activeOutlet.full_name}
            {activeOutlet.city ? ` · ${activeOutlet.city}` : ""}
          </div>
        )}
      </Card>

      <Card className="flex items-start gap-3 border-app-pastel-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-app-dark" />
        <div>
          Utsalg ligger under selskapet (legal entity) og opprettes i NBHub-admin
          under <code className="rounded bg-background px-1 py-0.5 text-[11px]">Outlets</code>.
          Bytt selskap i topbar (CompanyBlock) for å se utsalg under et annet
          selskap. Listen viser kun utsalg du har stillingstilgang til.
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Nr</TableHead>
              <TableHead>Kortnavn</TableHead>
              <TableHead>Fullt navn</TableHead>
              <TableHead className="w-[140px]">By</TableHead>
              <TableHead className="w-[120px]">Type</TableHead>
              <TableHead className="w-[160px] text-right">Handling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!legalEntityId && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Velg selskap i topbar først.
                </TableCell>
              </TableRow>
            )}
            {legalEntityId && isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Laster utsalg…
                </TableCell>
              </TableRow>
            )}
            {legalEntityId && !isLoading && accessible.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Ingen utsalg registrert under dette selskapet ennå. Opprett
                  utsalg i NBHub-admin → Outlets.
                </TableCell>
              </TableRow>
            )}
            {accessible.map((o) => {
              const isActive = o.id === outletId;
              return (
                <TableRow key={o.id} className={cn(isActive && "bg-app-light/40")}>
                  <TableCell className="font-mono text-sm">
                    #{o.display_number ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{o.short_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {o.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {o.city ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {o.outlet_type ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant={isActive ? "ghost" : "secondary"}
                      size="sm"
                      disabled={isActive}
                      onClick={() => setOutletId(o.id)}
                      className="gap-1.5"
                    >
                      {isActive ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Aktiv
                        </>
                      ) : (
                        "Sett som aktiv"
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
