import AdminLayout from "./AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

interface Props {
  title: string;
  phase: "1B" | "1C";
}

export default function AdminPlaceholder({ title, phase }: Props) {
  return (
    <AdminLayout title={title}>
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">
            Kommer i Admin Fase {phase}.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin" className="inline-flex items-center gap-1.5">
              <ArrowLeft className="h-4 w-4" /> Tilbake til Admin
            </Link>
          </Button>
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
