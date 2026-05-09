import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useLegalEntities } from "@/produksjon/features/produksjonsavdelinger/hooks/useLegalEntities";
import { useSelection } from "@/providers/SelectionProvider";
import { useLabelPrintProfiles } from "@/produksjon/features/utskriftsprofiler/hooks/useLabelPrintProfiles";
import {
  useArchiveLabelPrintProfile,
  useRestoreLabelPrintProfile,
} from "@/produksjon/features/utskriftsprofiler/hooks/useLabelPrintProfileMutations";
import { UtskriftsprofilDialog } from "@/produksjon/features/utskriftsprofiler/components/UtskriftsprofilDialog";
import { ArchiveProfileDialog } from "@/produksjon/features/utskriftsprofiler/components/ArchiveProfileDialog";
import { ProfileCard } from "@/produksjon/features/utskriftsprofiler/components/ProfileCard";
import type { LabelPrintProfile } from "@/produksjon/features/utskriftsprofiler/types";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("nb-NO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function UtskriftsprofilerPage() {
  const { data: entities } = useLegalEntities();
  const { legalEntityId: selectedLegalEntityId } = useSelection();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LabelPrintProfile | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<LabelPrintProfile | null>(
    null,
  );

  const effectiveEntityId = selectedLegalEntityId ?? undefined;
  const selectedEntity =
    entities?.find((e) => e.id === effectiveEntityId) ?? null;

  const { data: profiles, isLoading } =
    useLabelPrintProfiles(effectiveEntityId);

  const archiveMut = useArchiveLabelPrintProfile();
  const restoreMut = useRestoreLabelPrintProfile();

  const activeProfiles = useMemo(
    () => (profiles ?? []).filter((p) => p.status === "active"),
    [profiles],
  );
  const archivedProfiles = useMemo(
    () => (profiles ?? []).filter((p) => p.status === "archived"),
    [profiles],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (p: LabelPrintProfile) => {
    setEditing(p);
    setDialogOpen(true);
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    try {
      const updated = await archiveMut.mutateAsync(archiveTarget);
      toast.success(`Profilen "${updated.name}" er arkivert.`);
      setArchiveTarget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ukjent feil";
      toast.error(`Kunne ikke arkivere: ${msg}`);
    }
  };

  const handleRestore = async (p: LabelPrintProfile) => {
    try {
      const updated = await restoreMut.mutateAsync(p);
      toast.success(`"${updated.name}" er gjenopprettet.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ukjent feil";
      toast.error(`Kunne ikke gjenopprette: ${msg}`);
    }
  };

  return (
    <div>
      <nav className="mb-6 flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/produksjon" className="hover:text-foreground">
          Innstillinger
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">Utskriftsprofiler</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Utskriftsprofiler</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visuell etikett-designer. Dra felt fra panelet, plasser og endre
          størrelse fritt på etiketten.
        </p>
      </header>

      {selectedEntity && (
        <div className="mb-6 text-sm text-muted-foreground">
          Selskap: <span className="font-medium text-foreground">{selectedEntity.legal_name}</span>
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Aktive profiler ({activeProfiles.length})
        </h2>

        {isLoading ? (
          <div className="rounded-md border border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Laster …
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <button
              type="button"
              onClick={openCreate}
              disabled={!selectedEntity}
              className="group flex aspect-[3/2.5] flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-card transition hover:border-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                <Plus className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm font-medium">Ny profil</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Bygg en ny etikett-layout
              </p>
            </button>

            {activeProfiles.map((p) => (
              <ProfileCard
                key={p.id}
                profile={p}
                onEdit={() => openEdit(p)}
                onArchive={() => setArchiveTarget(p)}
              />
            ))}
          </div>
        )}

        {!isLoading && activeProfiles.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            Ingen utskriftsprofiler for{" "}
            {selectedEntity?.legal_name ?? "dette selskapet"} ennå. Bruk
            kortet over for å lage din første.
          </p>
        )}
      </section>

      {archivedProfiles.length > 0 && (
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
              Arkiverte profiler ({archivedProfiles.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Navn</TableHead>
                    <TableHead className="w-36">Arkivert</TableHead>
                    <TableHead className="w-16 text-right">Handling</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archivedProfiles.map((p) => (
                    <TableRow key={p.id} className="opacity-60">
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(p.updated_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRestore(p)}
                        >
                          Gjenopprett
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <UtskriftsprofilDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={editing ? "edit" : "create"}
        legalEntity={selectedEntity}
        existing={editing}
      />

      <ArchiveProfileDialog
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        profile={archiveTarget}
        onConfirm={handleArchive}
        isPending={archiveMut.isPending}
      />
    </div>
  );
}
