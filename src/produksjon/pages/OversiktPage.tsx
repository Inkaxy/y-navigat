import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLegalEntities } from "@/produksjon/features/produksjonsavdelinger/hooks/useLegalEntities";
import { useProductionDepartments } from "@/produksjon/features/produksjonsavdelinger/hooks/useProductionDepartments";
import { DepartmentCard } from "@/produksjon/features/oversikt/components/DepartmentCard";
import { useOversiktRealtime } from "@/produksjon/features/oversikt/hooks/useDepartmentLabelStats";
import { useSelection } from "@/providers/SelectionProvider";

export default function OversiktPage() {
  const { legalEntityId: selectedLegalEntityId } = useSelection();
  const legalEntityId = selectedLegalEntityId ?? "";
  const { data: entities } = useLegalEntities();

  const { data: departments, isLoading: depsLoading } = useProductionDepartments(
    legalEntityId || undefined,
    false,
  );

  const departmentIds = useMemo(
    () => departments?.map((d) => d.id) ?? [],
    [departments],
  );

  useOversiktRealtime(legalEntityId || undefined, departmentIds);

  const selectedEntity = entities?.find((e) => e.id === legalEntityId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Produksjon</h1>
          <p className="text-muted-foreground">
            Oversikt over etikett-aktivitet per produksjonsavdeling.
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Selskap
          </p>
          {entitiesLoading ? (
            <Skeleton className="h-10 w-56" />
          ) : (
            <Select value={legalEntityId} onValueChange={setLegalEntityId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Velg selskap" />
              </SelectTrigger>
              <SelectContent>
                {entities?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {depsLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-6 w-40 mb-2" />
              <Skeleton className="h-3 w-16 mb-6" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-full" />
            </Card>
          ))}
        </div>
      )}

      {!depsLoading && departments && departments.length === 0 && (
        <Card className="p-10 flex flex-col items-center text-center gap-4">
          <h3 className="text-lg font-semibold">
            Ingen produksjonsavdelinger for{" "}
            {selectedEntity?.legal_name ?? "valgt selskap"}.
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Opprett en avdeling for å begynne å spore etikett-utskrifter.
          </p>
          <Button asChild>
            <Link to="/produksjon/innstillinger/produksjonsavdelinger">Opprett avdeling</Link>
          </Button>
        </Card>
      )}

      {!depsLoading && departments && departments.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {departments.map((dept) => (
            <DepartmentCard key={dept.id} department={dept} />
          ))}
        </div>
      )}
    </div>
  );
}
