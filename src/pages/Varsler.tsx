import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Bell } from "lucide-react";

export default function Varsler() {
  useEffect(() => {
    document.title = "Varsler — NBHub";
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Varsler</h1>
      </header>
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
