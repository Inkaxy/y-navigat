import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useLegalEntities } from "@/produksjon/features/produksjonsavdelinger/hooks/useLegalEntities";
import { usePackingAreas } from "@/produksjon/features/pakkeomrader/hooks/usePackingAreas";
import {
  useArchivePackingArea,
  useRestorePackingArea,
} from "@/produksjon/features/pakkeomrader/hooks/usePackingAreaMutations";
import { PakkeomradeDialog } from "@/produksjon/features/pakkeomrader/components/PakkeomradeDialog";
import { ArchiveConfirmDialog } from "@/produksjon/features/pakkeomrader/components/ArchiveConfirmDialog";
import type { PackingArea } from "@/produksjon/features/pakkeomrader/types";

export default function PakkeomraderPage() {
  const { data: entities, isLoading: entitiesLoading } = useLegalEntities();
  const [selectedEntityId, setSelectedEntityId] = useState<string | undefined>();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PackingArea | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<PackingArea | null>(null);

  const effectiveEntityId =
    selectedEntityId ?? entities?.[0]?.id ?? undefined;

  const selectedEntity =
    entities?.find((e) => e.id === effectiveEntityId) ?? null;

  const { data: areas, isLoading: areasLoading } =
    usePackingAreas(effectiveEntityId);

  const archiveMut = useArchivePackingArea();
  const restoreMut = useRestorePackingArea();

  const activeAreas = useMemo(
    () => (areas ?? []).filter((a) => a.status === "active"),
    [areas],
  );
  const archivedAreas = useMemo(
    () => (areas ?? []).filter((a) => a.status === "archived"),
    [areas],
  );

  const suggestedDisplayOrder = useMemo(() => {
    if (!activeAreas.length) return 10;
    return Math.max(...activeAreas.map((a) => a.display_order)) + 10;
  }, [activeAreas]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (area: PackingArea) => {
    setEditing(area);
    setDialogOpen(true);
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    try {
      const updated = await archiveMut.mutateAsync(archiveTarget);
      toast.success(`"${updated.display_name}" er arkivert.`);
      setArchiveTarget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ukjent feil";
      toast.error(`Kunne ikke arkivere: ${msg}`);
    }
  };

  const handleRestore = async (area: PackingArea) => {
    try {
      const updated = await restoreMut.mutateAsync(area);
      toast.success(`"${updated.display_name}" er gjenopprettet.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ukjent feil";
      toast.error(`Kunne ikke gjenopprette: ${msg}`);
    }
  };

  return (
    <div>
      {/* Breadcrumbs */}
      <nav className="mb-6 flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Innstillinger
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">Pakkeområder</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Pakkeområder</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Definer hvor produkter pakkes (f.eks. løs, plastpose, brett). Brukes i
          pakke-flyten og senere på etiketter.
        </p>
      </header>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="pa-entity-select" className="text-sm">
            Selskap:
          </Label>
          <Select
            value={effectiveEntityId}
            onValueChange={(v) => setSelectedEntityId(v)}
            disabled={entitiesLoading || !entities?.length}
          >
            <SelectTrigger id="pa-entity-select" className="w-[260px]">
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

        <div className="ml-auto">
          <Button onClick={openCreate} disabled={!selectedEntity}>
            <Plus className="mr-2 h-4 w-4" />
            Nytt pakkeområde
          </Button>
        </div>
      </div>

      {/* Aktive */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          Aktive ({activeAreas.length})
        </h2>
        <div className="rounded-md border border-border bg-card">
          {areasLoading ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Laster …
            </div>
          ) : activeAreas.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm font-medium">
                Ingen pakkeområder for{" "}
                {selectedEntity?.legal_name ?? "dette selskapet"} ennå.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Legg til ditt første pakkeområde for å komme i gang.
              </p>
              <Button
                className="mt-4"
                onClick={openCreate}
                disabled={!selectedEntity}
              >
                <Plus className="mr-2 h-4 w-4" />
                Opprett første pakkeområde
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Kode</TableHead>
                  <TableHead>Navn</TableHead>
                  <TableHead className="w-32">Rekkefølge</TableHead>
                  <TableHead className="w-16 text-right">Handling</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeAreas.map((area) => (
                  <TableRow key={area.id}>
                    <TableCell className="font-mono text-xs">
                      {area.code}
                    </TableCell>
                    <TableCell className="font-medium">
                      {area.display_name}
                      {area.notes && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {area.notes}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{area.display_order}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Handlinger for ${area.display_name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEdit(area)}>
                            Rediger
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setArchiveTarget(area)}
                          >
                            Arkiver
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
      </section>

      {/* Arkiverte */}
      {archivedAreas.length > 0 && (
        <Collapsible open={archivedOpen} onOpenChange={setArchivedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="mb-2 flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {archivedOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Arkiverte ({archivedAreas.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Kode</TableHead>
                    <TableHead>Navn</TableHead>
                    <TableHead className="w-32">Rekkefølge</TableHead>
                    <TableHead className="w-16 text-right">Handling</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archivedAreas.map((area) => (
                    <TableRow key={area.id} className="opacity-60">
                      <TableCell className="font-mono text-xs">
                        {area.code}
                      </TableCell>
                      <TableCell className="font-medium">
                        {area.display_name}
                      </TableCell>
                      <TableCell>{area.display_order}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Handlinger for ${area.display_name}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => handleRestore(area)}
                            >
                              Gjenopprett
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <PakkeomradeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={editing ? "edit" : "create"}
        legalEntity={selectedEntity}
        existing={editing}
        suggestedDisplayOrder={suggestedDisplayOrder}
      />

      <ArchiveConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        area={archiveTarget}
        onConfirm={handleArchive}
        isPending={archiveMut.isPending}
      />
    </div>
  );
}
