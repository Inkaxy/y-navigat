import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getAppIcon } from "@/lib/appIcons";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { AppColorProvider } from "@/providers/AppColorProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";


interface Props {
  appCode: string;
  title: string;
  iconName: string;
}

export default function AppPlaceholder({ appCode, title, iconName }: Props) {
  useEffect(() => {
    document.title = `${title} — NBhub`;
  }, [title]);

  const Icon = getAppIcon(iconName);

  return (
    <AppColorProvider appCode={appCode}>
      <div className="space-y-6">
        <AppHeaderBanner
          icon={Icon}
          title={title}
          subtitle="Migrering til NBhub pågår — feature kommer i neste prompt."
        />

        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm text-muted-foreground">
              Denne ruta er en plassholder. Funksjonalitet for{" "}
              <span className="font-medium text-foreground">{title}</span>{" "}
              flyttes inn i NBhub i en kommende fase.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/hjem" className="inline-flex items-center gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                Tilbake til dashboard
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppColorProvider>
  );
}
