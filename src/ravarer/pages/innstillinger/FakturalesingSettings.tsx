// Råvarer › Innstillinger › Fakturalesing (bestilling 18.11.2026, C1–C5). Alt er AV til Henrik slår det på.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryLoadingState } from "@/components/common/QueryState";
import { useCompany } from "@/hooks/useCompany";
import { useCapability } from "@/lib/pendingRpc";
import { READER_CODE_DEPLOYED, READING_WAITING } from "@/ravarer/lib/fakturalesing/readingApi";
import { ReadingSwitchesCard } from "./fakturalesing/ReadingSwitchesCard";
import { SupplierProfilesCard } from "./fakturalesing/SupplierProfilesCard";
import { LearningExamplesCard } from "./fakturalesing/LearningExamplesCard";
import { GoldInvoicesCard } from "./fakturalesing/GoldInvoicesCard";
import { EhfTestCard } from "./fakturalesing/EhfTestCard";
import { ReadingHealthCard } from "@/ravarer/components/drift/ReadingHealthCard";
import { ReadingStallAlert } from "@/ravarer/components/drift/ReadingStallAlert";

export default function FakturalesingSettings() {
  const { data: company } = useCompany();
  const cap = useCapability("rm_cap_fakturalesing_v1");
  if (!company || cap === null) return <QueryLoadingState rows={4} />;
  return (
    <div className="space-y-6">
      <ReadingStallAlert />
      <ReadingHealthCard />
      {!READER_CODE_DEPLOYED && (
        <div role="status" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Fakturaleseren bruker ikke disse innstillingene ennå: den nye leserkoden er klar, men ikke rullet ut. Den venter på ja fra Henrik.
          Det du lagrer her, tas i bruk først etter utrullingen og bare for det som er slått på.
        </div>
      )}
      {cap === false ? (
        <Card>
          <CardHeader>
            <CardTitle>Opplæring av fakturaleseren</CardTitle>
            <CardDescription>{READING_WAITING}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Når databaseendringen er kjørt, kan du her slå på:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Varekatalog som fasit: leverandørens kjente varer sendes med lesingen.</li>
              <li>Leverandørprofil: én bekreftet profil per leverandør.</li>
              <li>Læring av rettinger: menneskelige rettinger blir eksempler for neste lesing.</li>
              <li>Selvkontroll med nytt forsøk og sterkere modell.</li>
              <li>Fasitsett: merk kontrollerte fakturaer og mål lesingen mot dem.</li>
            </ul>
          </CardContent>
        </Card>
      ) : (
        <>
          <ReadingSwitchesCard legalEntityId={company.id} />
          <SupplierProfilesCard legalEntityId={company.id} />
          <LearningExamplesCard legalEntityId={company.id} />
          <GoldInvoicesCard legalEntityId={company.id} />
        </>
      )}
      {/* EHF-test trenger ingen databaseendring; vises for godkjenner/admin uansett. */}
      <EhfTestCard key={company.id} legalEntityId={company.id} />
    </div>
  );
}
