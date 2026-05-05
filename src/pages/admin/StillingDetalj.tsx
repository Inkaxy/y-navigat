import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Briefcase, KeyRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";

export default function StillingDetalj() {
  const { id } = useParams<{ id: string }>();

  const { data: position } = useQuery({
    queryKey: ["admin-position", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("positions").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: access = [] } = useQuery({
    queryKey: ["admin-position-access", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("position_app_access")
        .select("level, app:apps(id, code, display_name, status)")
        .eq("position_id", id!);
      if (error) throw error;
      return (data ?? []).filter((r: any) => r.level !== "none");
    },
  });

  return (
    <AdminLayout title={position?.display_name ?? "Stilling"}>
      <AppHeaderBanner
        icon={Briefcase}
        title={position?.display_name ?? "Stilling"}
        subtitle={position?.code}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to={`/admin/tilganger?position=${id}`}>
              <KeyRound className="h-4 w-4" /> Endre tilganger
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-6 text-sm">
          <Info label="Kode" value={position?.code} />
          <Info label="Visningsnavn" value={position?.display_name} />
          <Info label="Kategori" value={position?.category} />
          <Info label="Scope" value={position?.scope_pattern} />
          <Info label="Status" value={position?.status} />
          <Info label="Sortering" value={String(position?.sort_order ?? "")} />
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground">Beskrivelse</div>
            <div>{position?.description ?? "—"}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-line p-4">
            <h3 className="font-semibold">Apper med tilgang</h3>
            <p className="text-sm text-muted-foreground">Endringer gjøres på Tilganger-siden.</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>Kode</TableHead>
                <TableHead>Tilgangsnivå</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {access.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Ingen tilganger</TableCell></TableRow>}
              {access.map((r: any) => (
                <TableRow key={r.app?.id}>
                  <TableCell className="font-medium">{r.app?.display_name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.app?.code}</TableCell>
                  <TableCell><Badge variant="outline">{r.level}</Badge></TableCell>
                  <TableCell><Badge variant="secondary">{r.app?.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminLayout>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value ?? "—"}</div>
    </div>
  );
}
