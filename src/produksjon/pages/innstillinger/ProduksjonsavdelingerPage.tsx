import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLegalEntities } from "@/produksjon/features/produksjonsavdelinger/hooks/useLegalEntities";
import { useProductionDepartments } from "@/produksjon/features/produksjonsavdelinger/hooks/useProductionDepartments";
import { useToggleProductionDepartmentStatus } from "@/produksjon/features/produksjonsavdelinger/hooks/useProductionDepartmentMutations";
import { ProduksjonsavdelingDialog } from "@/produksjon/features/produksjonsavdelinger/components/ProduksjonsavdelingDialog";
import type { ProductionDepartment } from "@/produksjon/features/produksjonsavdelinger/types";

export default function ProduksjonsavdelingerPage() {
  const { data: entities, isLoading: entitiesLoading } = useLegalEntities();
  const [selectedEntityId, setSelectedEntityId] = useState<string | undefined>();
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionDepartment | null>(null);

  // Default-velg første selskap når listen lastes
  const effectiveEntityId =
    selectedEntityId ?? entities?.[0]?.id ?? undefined;

  const selectedEntity =
    entities?.find((e) => e.id === effectiveEntityId) ?? null;

  const { data: departments, isLoading: departmentsLoading } =
    useProductionDepartments(effectiveEntityId, showInactive);

  const toggleMut = useToggleProductionDepartmentStatus();

  const suggestedSortOrder = useMemo(() => {
    if (!departments || departments.length === 0) return 100;
    return Math.max(...departments.map((d) => d.sort_order)) + 100;
  }, [departments]);

  const activeCount = useMemo(
    () => (departments ?? []).filter((d) => d.status === "active").length,
    [departments],
  );
  const inactiveCount = (departments?.length ?? 0) - activeCount;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (dept: ProductionDepartment) => {
    setEditing(dept);
    setDialogOpen(true);
  };

  const handleToggle = async (dept: ProductionDepartment) => {
    try {
      const updated = await toggleMut.mutateAsync(dept);
      toast.success(
        updated.status === "active"
          ? `"${updated.display_name}" er aktivert.`
          : `"${updated.display_name}" er satt inaktiv.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ukjent feil";
      toast.error(`Kunne ikke endre status: ${msg}`);
    }
  };

  return (
    <div className="container py-8">
      {/* Breadcrumbs */}
      <nav className="mb-6 flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/produksjon" className="hover:text-foreground">
          Innstillinger
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">Produksjonsavdelinger</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Produksjonsavdelinger
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Definer hvilke avdelinger som skriver ut etiketter. Brukes i
          etikett-skjerm og printer-routing.
        </p>
      </header>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="entity-select" className="text-sm">
            Selskap:
          </Label>
          <Select
            value={effectiveEntityId}
            onValueChange={(v) => setSelectedEntityId(v)}
            disabled={entitiesLoading || !entities?.length}
          >
            <SelectTrigger id="entity-select" className="w-[260px]">
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
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={setShowInactive}
          />
          <Label htmlFor="show-inactive" className="text-sm">
            Vis inaktive
          </Label>
        </div>

        <div className="ml-auto">
          <Button onClick={openCreate} disabled={!selectedEntity}>
            <Plus className="mr-2 h-4 w-4" />
            Ny avdeling
          </Button>
        </div>
      </div>

      {/* Tabell / tom-tilstand */}
      <div className="rounded-md border border-border bg-card">
        {departmentsLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Laster …
          </div>
        ) : !departments || departments.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium">
              Ingen avdelinger definert for {selectedEntity?.legal_name ?? "dette selskapet"}.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Opprett den første for å kunne route etiketter.
            </p>
            <Button className="mt-4" onClick={openCreate} disabled={!selectedEntity}>
              <Plus className="mr-2 h-4 w-4" />
              Opprett første avdeling
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="w-32">Kode</TableHead>
                <TableHead>Navn</TableHead>
                <TableHead className="w-28">Sortering</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-16 text-right">Handling</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((dept, idx) => (
                <TableRow
                  key={dept.id}
                  className={dept.status === "inactive" ? "opacity-60" : ""}
                >
                  <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{dept.code}</TableCell>
                  <TableCell className="font-medium">{dept.display_name}</TableCell>
                  <TableCell>{dept.sort_order}</TableCell>
                  <TableCell>
                    <span
                      className={
                        dept.status === "active"
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }
                    >
                      {dept.status === "active" ? "Aktiv" : "Inaktiv"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Handlinger for ${dept.display_name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openEdit(dept)}>
                          Rediger
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => handleToggle(dept)}>
                          {dept.status === "active" ? "Sett inaktiv" : "Sett aktiv"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Sticky-ish footer */}
      {departments && departments.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {showInactive
            ? `${departments.length} avdelinger vist (${activeCount} aktive, ${inactiveCount} inaktive)`
            : `${departments.length} ${departments.length === 1 ? "avdeling" : "avdelinger"} vist`}
        </p>
      )}

      <ProduksjonsavdelingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={editing ? "edit" : "create"}
        legalEntity={selectedEntity}
        existing={editing}
        suggestedSortOrder={suggestedSortOrder}
      />
    </div>
  );
}
