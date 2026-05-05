import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export function PlaceholderPage({ title, subtitle, body }: { title: string; subtitle: string; body: string }) {
  return (
    <>
      <AppHeaderBanner title={title} subtitle={subtitle} />
      <div className="px-6 py-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Construction className="h-10 w-10 text-app/60" />
            <h2 className="text-lg font-medium">Kommer snart</h2>
            <p className="max-w-md text-sm text-muted-foreground">{body}</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default PlaceholderPage;
