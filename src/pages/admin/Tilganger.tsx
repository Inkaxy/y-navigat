import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "./AdminLayout";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Level = "none" | "read" | "write" | "approve" | "admin";
const LEVELS: Level[] = ["none", "read", "write", "approve", "admin"];

const LEVEL_COLOR: Record<Level, string> = {
  none: "bg-muted text-muted-foreground",
  read: "bg-blue-100 text-blue-900",
  write: "bg-amber-100 text-amber-900",
  approve: "bg-purple-100 text-purple-900",
  admin: "bg-emerald-100 text-emerald-900",
};

export default function Tilganger() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const positionFilter = params.get("position");
  const [posSearch, setPosSearch] = useState("");
  const [appSearch, setAppSearch] = useState("");

  const { data: positions = [] } = useQuery({
    queryKey: ["admin-positions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("id, code, display_name, category")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: apps = [] } = useQuery({
    queryKey: ["admin-apps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("apps")
        .select("id, code, display_name, status")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: paa = [] } = useQuery({
    queryKey: ["admin-paa"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("position_app_access")
        .select("position_id, app_id, level");
      if (error) throw error;
      return data;
    },
  });

  const matrix = useMemo(() => {
    const m = new Map<string, Level>();
    for (const r of paa) m.set(`${r.position_id}::${r.app_id}`, r.level as Level);
    return m;
  }, [paa]);

  const update = useMutation({
    mutationFn: async ({ position_id, app_id, level }: { position_id: string; app_id: string; level: Level }) => {
      const { error } = await supabase
        .from("position_app_access")
        .upsert({ position_id, app_id, level } as any, { onConflict: "position_id,app_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-paa"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Kunne ikke oppdatere"),
  });

  const filteredPositions = positions.filter((p: any) =>
    !posSearch || p.display_name.toLowerCase().includes(posSearch.toLowerCase()) || p.code.toLowerCase().includes(posSearch.toLowerCase())
  );
  const filteredApps = apps.filter((a: any) =>
    !appSearch || a.display_name.toLowerCase().includes(appSearch.toLowerCase()) || a.code.toLowerCase().includes(appSearch.toLowerCase())
  );

  return (
    <AdminLayout title="Tilganger">
      <AppHeaderBanner
        icon={KeyRound}
        title="Tilganger"
        subtitle="Stilling × app — endringer lagres umiddelbart."
      />

      <div className="flex flex-wrap gap-2">
        <Input placeholder="Søk stilling…" value={posSearch} onChange={(e) => setPosSearch(e.target.value)} className="max-w-xs" />
        <Input placeholder="Søk app…" value={appSearch} onChange={(e) => setAppSearch(e.target.value)} className="max-w-xs" />
      </div>

      <div className="overflow-auto rounded-md border border-line bg-surface-canvas">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-canvas">
            <tr>
              <th className="sticky left-0 z-10 border-b border-r border-line bg-surface-canvas p-2 text-left">Stilling</th>
              {filteredApps.map((a: any) => (
                <th key={a.id} className="border-b border-line p-2 text-left text-xs font-medium">
                  {a.display_name}
                  <div className="font-mono text-[10px] text-muted-foreground">{a.code}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredPositions.map((p: any) => (
              <tr key={p.id} className="border-b border-line">
                <td className="sticky left-0 z-10 border-r border-line bg-surface-canvas p-2 font-medium">
                  {p.display_name}
                  <div className="font-mono text-[10px] text-muted-foreground">{p.code}</div>
                </td>
                {filteredApps.map((a: any) => {
                  const lvl = matrix.get(`${p.id}::${a.id}`) ?? "none";
                  return (
                    <td key={a.id} className="p-1">
                      <Select
                        value={lvl}
                        onValueChange={(v) => update.mutate({ position_id: p.id, app_id: a.id, level: v as Level })}
                      >
                        <SelectTrigger className={cn("h-8 w-[110px] text-xs", LEVEL_COLOR[lvl])}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LEVELS.map((l) => (
                            <SelectItem key={l} value={l}>{l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
