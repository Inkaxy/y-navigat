import { Store, Info, Check } from "lucide-react";
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
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";
import { cn } from "@/lib/utils";

export default function Utsalg() {
  const {
    activeEntity,
    availableEntities,
    setActiveEntity,
    isLoading,
    hasNoAccess,
  } = useLegalEntity();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-app-pastel text-app-dark">
          <Store className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Utsalg</h1>
          <p className="text-sm text-muted-foreground">
            Velg hvilket utsalg POS Styring skal vise data for.
          </p>
        </div>
      </div>

      <Card className="border-app-pastel-border bg-app-pastel/40 p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-app-dark">
          Aktivt utsalg
        </div>
        <div className="mt-1 text-lg font-semibold">
          {activeEntity
            ? `${activeEntity.short_code} — ${activeEntity.legal_name}`
            : isLoading
              ? "Laster…"
              : hasNoAccess
                ? "Ingen tilgang"
                : "Ikke valgt"}
        </div>
        {activeEntity?.org_number && (
          <div className="text-xs text-muted-foreground">
            Org.nr {activeEntity.org_number}
          </div>
        )}
      </Card>

      <Card className="flex items-start gap-3 border-app-pastel-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-app-dark" />
        <div>
          Nye utsalg opprettes i NBHub — denne listen speiler{" "}
          <code className="rounded bg-background px-1 py-0.5 text-[11px]">
            legal_entities
          </code>
          -tabellen og viser kun utsalg der du har en posisjon og write-tilgang
          til POS Styring.
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Kode</TableHead>
              <TableHead>Navn</TableHead>
              <TableHead className="w-[160px]">Org.nr</TableHead>
              <TableHead className="w-[160px] text-right">Handling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  Laster utsalg…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && availableEntities.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  Du har ingen POS-tilgang i noen utsalg ennå. Kontakt
                  administrator i NBHub.
                </TableCell>
              </TableRow>
            )}
            {availableEntities.map((entity) => {
              const isActive = entity.id === activeEntity?.id;
              return (
                <TableRow
                  key={entity.id}
                  className={cn(isActive && "bg-app-light/40")}
                >
                  <TableCell className="font-mono text-sm font-medium">
                    {entity.short_code}
                  </TableCell>
                  <TableCell className="text-sm">{entity.legal_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {entity.org_number}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant={isActive ? "ghost" : "secondary"}
                      size="sm"
                      disabled={isActive}
                      onClick={() => setActiveEntity(entity.id)}
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
