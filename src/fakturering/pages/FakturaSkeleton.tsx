import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";

interface Props {
  title: string;
  subtitle?: string;
  body?: string;
}

export default function FakturaSkeleton({ title, subtitle, body }: Props) {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Fakturering" title={title} subtitle={subtitle} />
      <Card className="p-8 text-sm text-muted-foreground">
        {body ?? "Bygges i neste steg. Datamodellen er klar."}
      </Card>
    </div>
  );
}
