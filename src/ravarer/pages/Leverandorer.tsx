import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Truck, Plus } from "lucide-react";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { NewSupplierDialog } from "@/ravarer/components/NewSupplierDialog";

export default function LeverandorerPage() {
  const { data: rows = [], isLoading } = useSuppliers();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.org_number ?? "").toLowerCase().includes(q) ||
        (r.contact_email ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner title="Leverandører" subtitle="Alle aktive leverandører for valgt selskap" />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk navn, org.nr eller e-post…"
              className="pl-9"
            />
          </div>
          <span className="text-sm text-ink-secondary">{filtered.length} leverandører</span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-ink-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Truck className="mb-3 h-10 w-10 text-ink-secondary" />
            <p className="text-ink-secondary">Ingen leverandører funnet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                <tr>
                  <th className="px-4 py-3">Navn</th>
                  <th className="px-4 py-3">Org.nr</th>
                  <th className="px-4 py-3">E-post</th>
                  <th className="px-4 py-3">Telefon</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-line-subtle hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{r.org_number ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-secondary">{r.contact_email ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-secondary">{r.contact_phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      {r.is_active ? (
                        <Badge variant="outline" className="border-success/30 bg-success/10 text-success">Aktiv</Badge>
                      ) : (
                        <Badge variant="outline" className="text-ink-secondary">Inaktiv</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
