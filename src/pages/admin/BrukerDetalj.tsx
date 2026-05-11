import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { User, X, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState } from "react";
import { useIsPlatformOwner } from "@/hooks/useIsPlatformOwner";
import { useAuth } from "@/hooks/useAuth";

export default function BrukerDetalj() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
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

  return (
    <AdminLayout title={user?.display_name ?? "Bruker"}>
      <AppHeaderBanner
        icon={User}
        title={user?.display_name ?? "Bruker"}
        subtitle={user?.email}
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
          <div className="border-b border-line p-4">
            <h3 className="font-semibold">Stillinger</h3>
            <p className="text-sm text-muted-foreground">Aktiv = i dag mellom Fra og Til.</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stilling</TableHead>
                <TableHead>Selskap</TableHead>
                <TableHead>Fra</TableHead>
                <TableHead>Til</TableHead>
                <TableHead>Aktiv</TableHead>
                <TableHead className="text-right">Handling</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Ingen stillinger</TableCell></TableRow>}
              {positions.map((p: any) => {
                const active = p.valid_from <= today && (!p.valid_to || p.valid_to > today);
                return (
                  <TableRow key={p.id}>
                    <TableCell>{p.position?.display_name} {p.is_primary && <Badge variant="outline">Primær</Badge>}</TableCell>
                    <TableCell>{p.legal_entity?.short_code}</TableCell>
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
