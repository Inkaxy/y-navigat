import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppBanner } from "@/kunder/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  type CustomerGroup,
  useCustomerGroups,
  useDeleteCustomerGroup,
} from "@/kunder/hooks/useCustomerGroups";
import { useSelectedEntity } from "@/kunder/state/SelectedEntityContext";
import { useUserAccess } from "@/kunder/hooks/useUserAccess";
import { useAuth } from "@/hooks/useAuth";
import { CustomerGroupEditor } from "@/kunder/components/groups/CustomerGroupEditor";

export default function CustomerGroups() {
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const { selected, isAll } = useSelectedEntity();
  const legalEntityId = isAll ? null : selected;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<CustomerGroup | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CustomerGroup | null>(null);

  const { data: groups, isLoading } = useCustomerGroups(legalEntityId);
  const del = useDeleteCustomerGroup();

  const filtered = useMemo(() => {
    if (!groups) return [];
    const s = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (statusFilter !== "all" && g.status !== statusFilter) return false;
      if (!s) return true;
      return (
        g.display_name.toLowerCase().includes(s) ||
        g.code.toLowerCase().includes(s) ||
        (g.description ?? "").toLowerCase().includes(s)
      );
    });
  }, [groups, search, statusFilter]);

  const canWrite = !!access?.hasKunderWrite && !!legalEntityId;

  return (
    <div className="space-y-6 pb-12">
      <AppBanner
        title="Kundegrupper"
        subtitle="Segmenter for prising og rapportering"
        icon={Users}
        actions={
          canWrite ? (
            <Button
              onClick={() => {
                setEditingGroup(null);
                setEditorOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Ny gruppe
            </Button>
          ) : null
        }
      />

      <div className="container space-y-4">
        {!legalEntityId && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Velg et selskap i topbar for å administrere kundegrupper.
            </CardContent>
          </Card>
        )}

        {legalEntityId && (
          <>
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Søk etter navn, kode eller beskrivelse…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Aktive</SelectItem>
                  <SelectItem value="archived">Arkiverte</SelectItem>
                  <SelectItem value="all">Alle</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster grupper…
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    {groups?.length === 0
                      ? "Ingen kundegrupper ennå. Opprett den første for å samle kunder med felles prisliste."
                      : "Ingen treff på filteret."}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Gruppe</TableHead>
                        <TableHead>Kode</TableHead>
                        <TableHead>Medlemmer</TableHead>
                        <TableHead>Default prisliste</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Handlinger</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((g) => (
                        <TableRow key={g.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-block h-3 w-3 shrink-0 rounded-full"
                                style={{ backgroundColor: g.color_hex ?? "hsl(var(--muted-foreground))" }}
                              />
                              <div>
                                <p className="font-medium">{g.display_name}</p>
                                {g.description && (
                                  <p className="text-xs text-muted-foreground">{g.description}</p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{g.code}</TableCell>
                          <TableCell>{g.member_count}</TableCell>
                          <TableCell>
                            {g.price_list_name ? (
                              <Badge variant="outline">{g.price_list_name}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={g.status === "active" ? "default" : "secondary"}>
                              {g.status === "active" ? "Aktiv" : "Arkivert"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingGroup(g);
                                setEditorOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {canWrite && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmDelete(g)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {legalEntityId && (
        <CustomerGroupEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          legalEntityId={legalEntityId}
          group={editingGroup}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett gruppe?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.display_name} vil bli slettet. Medlemskap fjernes, men kundene
              berøres ikke. Kan ikke angres.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDelete) return;
                try {
                  await del.mutateAsync({
                    id: confirmDelete.id,
                    legal_entity_id: confirmDelete.legal_entity_id,
                    display_name: confirmDelete.display_name,
                    code: confirmDelete.code,
                  });
                  toast.success("Gruppe slettet");
                  setConfirmDelete(null);
                } catch (e: any) {
                  toast.error(e?.message ?? "Kunne ikke slette");
                }
              }}
            >
              Slett
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
