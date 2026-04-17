import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { Bell } from "lucide-react";

export default function Varsler() {
  useEffect(() => {
    document.title = "Varsler — NBHub";
  }, []);

  return (
    <div className="space-y-6">
      <AppHeaderBanner
        icon={Bell}
        title="Varsler"
        subtitle="Plattformvarsler og påminnelser samles her."
      />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Bell className="h-6 w-6" />
          </div>
          <p className="text-sm text-muted-foreground">Varsler kommer i neste versjon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
