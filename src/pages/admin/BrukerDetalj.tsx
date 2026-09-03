import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { User, X, Trash2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState } from "react";
import { useIsPlatformOwner } from "@/hooks/useIsPlatformOwner";
import { useAuth } from "@/hooks/useAuth";
import { osloTodayISO } from "@/lib/osloDate";

export default function BrukerDetalj() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = osloTodayISO();
  const { data: isOwner = false } = useIsPlatformOwner();
  const { user: authUser } = useAuth();
  const [deleting, setDeleting] = useState(false);

  const { data: user } = useQuery({
    queryKey: ["admin-user", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, display_name, first_name, last_name, email, phone, status, last_login_at")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: positions = [] } = useQuery({
    queryKey: ["admin-user-positions", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_positions")
        .select(`
          id, valid_from, valid_to, is_primary,
          position:positions(code, display_name),
          legal_entity:legal_entities(short_code, legal_name)
        `)
        .eq("user_id", id!)
        .order("valid_from", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const terminate = useMutation({
    mutationFn: async (posId: string) => {
      const { error } = await supabase
        .from("user_positions")
        .update({ valid_to: today })
        .eq("id", posId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-positions", id] });
      toast.success("Stilling terminert");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const canDelete = isOwner && id && id !== authUser?.id;

  async function handleDelete() {
    if (!id) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-user", {
        body: { user_id: id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Bruker slettet");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      navigate("/admin/brukere");
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke slette bruker");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AdminLayout title={user?.display_name ?? "Bruker"}>
      <AppHeaderBanner
        icon={User}
        title={user?.display_name ?? "Bruker"}
        subtitle={user?.email}
        actions={
          canDelete ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" disabled={deleting}>
                  <Trash2 className="h-4 w-4" /> Slett bruker
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Slett bruker?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Dette vil permanent slette {user?.display_name ?? "brukeren"} fra
                    innloggingssystemet og avslutte alle aktive stillinger. Handlingen kan
                    ikke angres.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Slett bruker
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null
        }
      />

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-6">
          <ReadOnly label="Fornavn" value={user?.first_name ?? ""} />
          <ReadOnly label="Etternavn" value={user?.last_name ?? ""} />
          <ReadOnly label="E-post" value={user?.email ?? ""} />
          <ReadOnly label="Telefon" value={user?.phone ?? ""} />
          <ReadOnly label="Status" value={user?.status ?? ""} />
          <ReadOnly
            label="Sist innlogget"
            value={user?.last_login_at ? new Date(user.last_login_at).toLocaleString("no-NO") : "—"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-line p-4">
            <div>
              <h3 className="font-semibold">Stillinger</h3>
              <p className="text-sm text-muted-foreground">Aktiv = i dag mellom Fra og Til.</p>
            </div>
            {id && <AddPositionDialog userId={id} assignedBy={authUser?.id ?? null} />}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stilling</TableHead>
                <TableHead>Fra</TableHead>
                <TableHead>Til</TableHead>
                <TableHead>Aktiv</TableHead>
                <TableHead className="text-right">Handling</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Ingen stillinger</TableCell></TableRow>}
              {positions.map((p: any) => {
                const active = p.valid_from <= today && (!p.valid_to || p.valid_to > today);
                return (
                  <TableRow key={p.id}>
                    <TableCell>{p.position?.display_name} {p.is_primary && <Badge variant="outline">Primær</Badge>}</TableCell>
                    <TableCell>{p.valid_from}</TableCell>
                    <TableCell>{p.valid_to ?? "—"}</TableCell>
                    <TableCell><Badge variant={active ? "default" : "secondary"}>{active ? "Aktiv" : "Avsluttet"}</Badge></TableCell>
                    <TableCell className="text-right">
                      {active && (
                        <Button size="sm" variant="ghost" onClick={() => terminate.mutate(p.id)}>
                          <X className="h-3.5 w-3.5" /> Terminér
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminLayout>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={value} readOnly className="bg-muted/30" />
    </div>
  );
}

function AddPositionDialog({ userId, assignedBy }: { userId: string; assignedBy: string | null }) {
  const qc = useQueryClient();
  const today = osloTodayISO();
  const [open, setOpen] = useState(false);
  const [positionId, setPositionId] = useState<string>("");
  const [legalEntityId, setLegalEntityId] = useState<string>("");
  const [validFrom, setValidFrom] = useState<string>(today);
  const [validTo, setValidTo] = useState<string>("");
  const [isPrimary, setIsPrimary] = useState(false);

  const { data: positions = [] } = useQuery({
    queryKey: ["positions-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("id, code, display_name")
        .order("display_name");
      if (error) throw error;
      return data ?? [];
    },
  });


  const reset = () => {
    setPositionId(""); setLegalEntityId(""); setValidFrom(today); setValidTo(""); setIsPrimary(false);
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!positionId || !legalEntityId) throw new Error("Velg stilling og selskap");
      const { error } = await supabase.from("user_positions").insert({
        user_id: userId,
        position_id: positionId,
        legal_entity_id: legalEntityId,
        valid_from: validFrom,
        valid_to: validTo || null,
        is_primary: isPrimary,
        outlet_scope: "all",
        outlet_ids: [],
        assigned_by: assignedBy,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-positions", userId] });
      toast.success("Stilling lagt til");
      reset();
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Kunne ikke legge til stilling"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4" /> Legg til stilling</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Legg til stilling</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Stilling</Label>
            <Select value={positionId} onValueChange={setPositionId}>
              <SelectTrigger><SelectValue placeholder="Velg stilling" /></SelectTrigger>
              <SelectContent>
                {positions.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fra</Label>
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div>
              <Label>Til (valgfri)</Label>
              <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="is-primary" checked={isPrimary} onCheckedChange={(v) => setIsPrimary(v === true)} />
            <Label htmlFor="is-primary" className="cursor-pointer">Primær stilling</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Avbryt</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? "Lagrer …" : "Legg til"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
