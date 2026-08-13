import { useMemo, useState } from "react";
import { Layers, Plus, MoreVertical, Trash2, Archive, ArchiveRestore, Pencil, Info, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";
import {
  useStatisticGroups,
  useGroupMembers,
  useAddableProducts,
  useGroupMutations,
  type StatisticGroup,
} from "@/rapporter/hooks/useStatisticGroups";

export default function Statistikkgrupper() {
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  const { data: groups, isLoading } = useStatisticGroups(showArchived);
  const selected = useMemo(
    () => (groups ?? []).find((g) => g.id === selectedId) ?? (groups ?? [])[0] ?? null,
    [groups, selectedId],
  );
  const { data: members, isLoading: membersLoading } = useGroupMembers(selected?.id ?? null);
  const { createGroup, updateGroup, deleteGroup, addMember, removeMember } = useGroupMutations();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rapporter"
        title="Statistikkgrupper"
        subtitle="Analysedimensjon og vareutvalg"
        icon={Layers}
      />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Venstre panel — gruppeliste */}
        <Card className="h-fit">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Grupper</h2>
              <div className="flex items-center gap-2">
                <Label htmlFor="show-archived" className="text-xs text-muted-foreground">
                  Vis arkiverte
                </Label>
                <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
              </div>
            </div>

            <div className="space-y-2">
              {isLoading ? (
                <>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </>
              ) : (groups ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Ingen grupper ennå.</p>
              ) : (
                (groups ?? []).map((g) => (
                  <GroupRow
                    key={g.id}
                    group={g}
                    active={selected?.id === g.id}
                    onSelect={() => setSelectedId(g.id)}
                    onArchive={() =>
                      g.is_report_bound
                        ? toast.error("Denne gruppen styrer NG-rapporten og kan ikke arkiveres.")
                        : updateGroup.mutate({ id: g.id, status: g.status === "active" ? "archived" : "active" })
                    }
                    onDelete={() =>
                      g.is_report_bound
                        ? toast.error("Denne gruppen styrer NG-rapporten og kan ikke slettes.")
                        : deleteGroup.mutate(g)
                    }
                  />
                ))
              )}
            </div>

            <form
              className="flex gap-2 border-t border-border pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                createGroup.mutate(newName, { onSuccess: () => setNewName("") });
              }}
            >
              <Input
                placeholder="Ny gruppe …"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button type="submit" size="icon" disabled={!newName.trim() || createGroup.isPending}>
                <Plus className="h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Høyre panel — valgt gruppe */}
        <Card>
          <CardContent className="space-y-4 p-5">
            {!selected ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Velg en gruppe til venstre, eller opprett en ny.
              </p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold tracking-tight">{selected.display_name}</h2>
                      {selected.is_report_bound && (
                        <Badge className="border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-100">
                          Styrer NG-filen
                        </Badge>
                      )}
                      {selected.status === "archived" && <Badge variant="secondary">Arkivert</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {members?.length ?? 0} varer
                      {selected.description ? ` — ${selected.description}` : ""}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Rediger
                  </Button>
                </div>

                {selected.is_report_bound && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Denne gruppen bestemmer hvilke varer som sendes i NG-rapporten. Endringer påvirker neste
                      eksport.
                    </span>
                  </div>
                )}

                <AddProductCombobox
                  excludeIds={(members ?? []).map((m) => m.product_id)}
                  onPick={(p) => addMember.mutate({ groupId: selected.id, product: p })}
                />

                {membersLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : (members ?? []).length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Ingen varer ennå — søk over for å legge til
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Varenr</TableHead>
                        <TableHead>Varenavn</TableHead>
                        <TableHead>Kategori</TableHead>
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(members ?? []).map((m) => (
                        <TableRow key={m.product_id}>
                          <TableCell className="tabular-nums text-muted-foreground">{m.display_number}</TableCell>
                          <TableCell>
                            <span className="mr-2">{m.display_name}</span>
                            {m.group_count > 1 && (
                              <Badge variant="secondary" className="text-xs">
                                flere grupper
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{m.category ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeMember.mutate({ groupId: selected.id, member: m })}
                            >
                              <X className="mr-1 h-4 w-4" />
                              Fjern
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {selected && (
        <EditGroupDialog
          key={selected.id}
          open={editOpen}
          onOpenChange={setEditOpen}
          group={selected}
          onSave={(patch) =>
            updateGroup.mutate({ id: selected.id, ...patch }, { onSuccess: () => setEditOpen(false) })
          }
        />
      )}
    </div>
  );
}

function GroupRow({
  group,
  active,
  onSelect,
  onArchive,
  onDelete,
}: {
  group: StatisticGroup;
  active: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "flex items-start justify-between gap-2 rounded-lg border p-3 text-left transition-colors",
        active ? "border-[hsl(var(--app-primary))] bg-accent/40" : "border-border hover:bg-accent/20",
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="truncate text-sm font-medium">{group.display_name}</div>
        <div className="text-xs text-muted-foreground">{group.member_count} varer</div>
        <div className="flex flex-wrap gap-1">
          {group.is_report_bound && (
            <Badge className="border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-100">
              Styrer NG-filen
            </Badge>
          )}
          {group.status === "archived" && <Badge variant="secondary">Arkivert</Badge>}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => e.stopPropagation()}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
          >
            {group.status === "active" ? (
              <>
                <Archive className="mr-2 h-4 w-4" /> Arkiver
              </>
            ) : (
              <>
                <ArchiveRestore className="mr-2 h-4 w-4" /> Aktiver
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Slett
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AddProductCombobox({
  excludeIds,
  onPick,
}: {
  excludeIds: string[];
  onPick: (p: { id: string; display_number: number; display_name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const { data: products, isLoading } = useAddableProducts(debounced, excludeIds, open);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <Plus className="mr-2 h-4 w-4" />
          Legg til vare …
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Søk varenr eller navn …" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-[300px]">
            {isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Laster …</div>
            ) : (
              <>
                <CommandEmpty>Ingen treff.</CommandEmpty>
                <CommandGroup>
                  {(products ?? []).map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      onSelect={() => {
                        onPick(p);
                        setOpen(false);
                        setSearch("");
                      }}
                      className="flex items-center gap-3"
                    >
                      <span className="tabular-nums text-muted-foreground">{p.display_number}</span>
                      <span className="flex-1 truncate">{p.display_name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function EditGroupDialog({
  open,
  onOpenChange,
  group,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: StatisticGroup;
  onSave: (patch: { display_name: string; description: string | null }) => void;
}) {
  const [name, setName] = useState(group.display_name);
  const [desc, setDesc] = useState(group.description ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rediger gruppe</DialogTitle>
          <DialogDescription>Endre navn og beskrivelse for statistikkgruppen.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="grp-name">Navn</Label>
            <Input id="grp-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grp-desc">Beskrivelse</Label>
            <Textarea id="grp-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => onSave({ display_name: name.trim(), description: desc.trim() || null })}
          >
            Lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
