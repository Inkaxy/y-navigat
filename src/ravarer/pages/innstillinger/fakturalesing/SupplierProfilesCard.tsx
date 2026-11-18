import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryEmptyState, QueryErrorState, QueryLoadingState } from "@/components/common/QueryState";
import { formatDate } from "@/ravarer/lib/constants";
import { useSupplierProfiles } from "@/ravarer/lib/fakturalesing/readingApi";
import { ProfileEditor } from "./ProfileEditor";

/** C2: én profil per leverandør. Utkast lages fra 3–5 fakturaer; bare bekreftede sendes med lesingen. */
export function SupplierProfilesCard({ legalEntityId }: { legalEntityId: string }) {
  const q = useSupplierProfiles(legalEntityId);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card id="innst-fakturalesing-profiler">
      <CardHeader>
        <CardTitle>Leverandørprofiler</CardTitle>
        <CardDescription>Hvor varenummeret står, kolonner, antall/D-pak/F-pak, pakning, rabatt, pant og avgifter. Bare bekreftede profiler brukes når «Leverandørprofil» er på.</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isError ? <QueryErrorState error={q.error} scope="fakturalesing-profiler" onRetry={() => void q.refetch()} title="Kunne ikke hente leverandørprofilene" />
          : !q.data ? <QueryLoadingState rows={4} />
          : q.data.length === 0 ? <QueryEmptyState title="Ingen leverandører med fakturalinjer" />
          : (
            <ul className="divide-y">
              {q.data.map((r) => (
                <li key={r.supplierId} className="py-2">
                  <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium">{r.supplierName}</span>
                      <span className="ml-2 text-caption text-muted-foreground">{r.invoiceCount} fakturaer</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.status === "bekreftet" && <Badge variant="secondary">Bekreftet {r.confirmedAt ? formatDate(r.confirmedAt) : ""}</Badge>}
                      {r.status === "utkast" && <Badge variant="outline">Utkast</Badge>}
                      {r.status === null && <span className="text-caption text-muted-foreground">Ingen profil</span>}
                      <Button variant="outline" size="sm" className="min-h-[44px]" aria-expanded={open === r.supplierId}
                        onClick={() => setOpen(open === r.supplierId ? null : r.supplierId)}>
                        {open === r.supplierId ? "Lukk" : r.status ? "Rediger" : "Lag profil"}
                      </Button>
                    </div>
                  </div>
                  {open === r.supplierId && (
                    <div className="mt-2">
                      <ProfileEditor key={r.supplierId} legalEntityId={legalEntityId} row={r} onSaved={() => q.refetch()} onClose={() => setOpen(null)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </CardContent>
    </Card>
  );
}
