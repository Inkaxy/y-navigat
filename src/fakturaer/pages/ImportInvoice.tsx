import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, ArrowLeft } from "lucide-react";
import { FakturaerHeaderBanner } from "@/fakturaer/components/FakturaerHeaderBanner";
import ImportEhfPage from "./ImportEhf";
import ImportPdfPage from "./ImportPdf";
import NewInvoicePage from "./NewInvoice";

const TABS = ["ehf", "pdf", "manuelt"] as const;
type TabKey = typeof TABS[number];

export default function ImportInvoicePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = (params.get("tab") ?? "ehf") as TabKey;
  const tab: TabKey = TABS.includes(tabParam) ? tabParam : "ehf";

  useEffect(() => {
    if (!params.get("tab")) {
      const next = new URLSearchParams(params);
      next.set("tab", "ehf");
      setParams(next, { replace: true });
    }
  }, []);

  const setTab = (next: string) => {
    const sp = new URLSearchParams(params);
    sp.set("tab", next);
    setParams(sp, { replace: false });
  };

  return (
    <div className="space-y-5">
      <button
        onClick={() => navigate("/ravarer/fakturaer")}
        className="flex items-center gap-1 text-sm text-ink-secondary transition-colors hover:text-ink-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Tilbake til fakturaer
      </button>

      <FakturaerHeaderBanner
        title="Importer faktura manuelt"
        subtitle="Bruk denne siden for fakturaer som ikke kommer automatisk fra Tripletex"
      />

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Manuell import er for unntakstilfeller</AlertTitle>
        <AlertDescription className="text-sm mt-1">
          Fakturaer importeres normalt automatisk fra Tripletex. Bruk denne siden kun når
          fakturaen mangler vedlegg i Tripletex, er gammel og må etter-registreres,
          eller aldri har vært i Tripletex.
        </AlertDescription>
      </Alert>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="ehf">Fra EHF-fil</TabsTrigger>
          <TabsTrigger value="pdf">Fra PDF</TabsTrigger>
          <TabsTrigger value="manuelt">Manuelt skjema</TabsTrigger>
        </TabsList>

        <TabsContent value="ehf" className="mt-5">
          <ImportEhfPage embedded />
        </TabsContent>
        <TabsContent value="pdf" className="mt-5">
          <ImportPdfPage embedded />
        </TabsContent>
        <TabsContent value="manuelt" className="mt-5">
          <NewInvoicePage embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
