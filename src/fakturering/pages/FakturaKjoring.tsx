import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";

export default function FakturaKjoring() {
  return (
    <div className="space-y-6">
      <PageHeader title="Fakturakjøring" description="Kjør fakturaer basert på leverte pakksedler." />
      <Card className="p-8 text-sm text-muted-foreground">
        Fakturakjøringen bygges i neste steg. Datamodellen er klar.
      </Card>
    </div>
  );
}
