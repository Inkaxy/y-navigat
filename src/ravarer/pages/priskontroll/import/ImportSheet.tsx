import { Suspense, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { lazyWithReload as lazy } from "@/lib/lazyWithReload";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QueryLoadingState } from "@/components/common/QueryState";
import { paths } from "@/ravarer/lib/paths";

const ImportEhf = lazy(() => import("@/fakturaer/pages/ImportEhf"));
const ImportPdf = lazy(() => import("@/fakturaer/pages/ImportPdf"));
const NewInvoice = lazy(() => import("@/fakturaer/pages/NewInvoice"));

export const IMPORT_TABS = ["ehf", "pdf", "manuelt"] as const;
export type ImportTab = (typeof IMPORT_TABS)[number];

export function parseImportTab(v: string | null): ImportTab | null {
  return v && (IMPORT_TABS as readonly string[]).includes(v) ? (v as ImportTab) : null;
}

/** «Importer faktura» som sidepanel (`?importer=ehf|pdf|manuelt`). Logikken er de samme importsidene. */
export function ImportSheet() {
  const [sp, setSp] = useSearchParams();
  const tab = parseImportTab(sp.get("importer"));
  const [done, setDone] = useState<{ id: string | null } | null>(null);
  const [round, setRound] = useState(0);

  const setTab = (t: ImportTab | null) => {
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      if (t) p.set("importer", t);
      else p.delete("importer");
      return p;
    });
    if (!t) setDone(null);
  };
  const onImported = (id: string | null) => setDone({ id });

  return (
    <Sheet open={!!tab} onOpenChange={(v) => { if (!v) setTab(null); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Importer faktura</SheetTitle>
          <SheetDescription>
            Fakturaer kommer normalt automatisk fra Tripletex. Bruk import for fakturaer uten vedlegg i Tripletex, eldre fakturaer eller fakturaer som aldri har vært der.
          </SheetDescription>
        </SheetHeader>
        {done ? (
          <div role="status" className="mt-6 space-y-4 rounded-lg border border-success/40 bg-success/5 p-4">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden />Fakturaen er importert</p>
            <div className="flex flex-wrap gap-2">
              {done.id ? (
                <Button asChild size="sm"><Link to={paths.faktura(done.id)}>Åpne fakturaen</Link></Button>
              ) : (
                <Button asChild size="sm"><Link to={paths.fakturaer({ visning: "trenger" })} onClick={() => setTab(null)}>Åpne fakturaene</Link></Button>
              )}
              <Button size="sm" variant="outline" onClick={() => { setDone(null); setRound((r) => r + 1); }}>Importer en til</Button>
            </div>
          </div>
        ) : (
          <Tabs value={tab ?? "ehf"} onValueChange={(v) => setTab(parseImportTab(v))} className="mt-4">
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="ehf">EHF</TabsTrigger>
              <TabsTrigger value="pdf">PDF</TabsTrigger>
              <TabsTrigger value="manuelt">Manuell</TabsTrigger>
            </TabsList>
            <Suspense fallback={<QueryLoadingState rows={4} />}>
              <TabsContent value="ehf" className="mt-4"><ImportEhf key={round} embedded onImported={onImported} /></TabsContent>
              <TabsContent value="pdf" className="mt-4"><ImportPdf key={round} embedded onImported={onImported} /></TabsContent>
              <TabsContent value="manuelt" className="mt-4"><NewInvoice key={round} embedded onImported={onImported} /></TabsContent>
            </Suspense>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
