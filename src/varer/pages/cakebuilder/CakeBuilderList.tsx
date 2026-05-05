import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cake, Plus, Loader2, Eye } from "lucide-react";
import { NB_LEGAL_ENTITY_ID, CAKE_CATEGORY_STATUS_LABEL } from "@/varer/lib/constants";
import { useAppContext } from "@/varer/context/AppContext";
import { NewCategoryDialog } from "./NewCategoryDialog";
import { CakeBuilderPreview } from "./CakeBuilderPreview";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-success/15 text-success border-success/30",
  draft: "bg-muted text-muted-foreground border-border",
  discontinued: "bg-destructive/10 text-destructive border-destructive/30",
};

export default function CakeBuilderList() {
  const navigate = useNavigate();
  const { canWrite } = useAppContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const categories = useQuery({
    queryKey: ["cake-categories", NB_LEGAL_ENTITY_ID],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_cake_categories_with_counts", {
        p_legal_entity_id: NB_LEGAL_ENTITY_ID,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const list = categories.data ?? [];

  return (
    <>
      <AppHeaderBanner
        title="Kakebygger"
        subtitle="Kategorier, steg og byggeklosser for kunde-wizarden"
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setPreviewOpen(true)}
              variant="outline"
              className="bg-white/10 text-white hover:bg-white/20 border-white/20"
              size="sm"
            >
              <Eye className="mr-1.5 h-4 w-4" />
              Forhåndsvis
            </Button>
            {canWrite && (
              <Button
                onClick={() => setDialogOpen(true)}
                className="bg-white text-app-dark hover:bg-white/90"
                size="sm"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Ny kake-kategori
              </Button>
            )}
          </div>
        }
      />

      <div className="px-6 py-6">
        {categories.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : list.length === 0 ? (
          <Card className="p-12 text-center">
            <Cake className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <div className="font-medium">Ingen kake-kategorier ennå</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Klikk «Ny kake-kategori» for å komme i gang.
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((c) => (
              <Card
                key={c.id}
                onClick={() => navigate(`/varer/kakebygger/${c.id}`)}
                className="group cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
              >
                <div className="relative aspect-[4/3] bg-muted">
                  {c.image_url ? (
                    <img
                      src={c.image_url}
                      alt={c.name}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Cake className="h-12 w-12 text-muted-foreground/40" />
                    </div>
                  )}
                  <Badge
                    variant="outline"
                    className={`absolute right-2 top-2 ${STATUS_BADGE[c.status] ?? ""}`}
                  >
                    {CAKE_CATEGORY_STATUS_LABEL[c.status] ?? c.status}
                  </Badge>
                </div>
                <div className="p-4">
                  <div className="font-medium">{c.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {c.step_count} steg · {c.product_count} byggeklosser
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <NewCategoryDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <CakeBuilderPreview open={previewOpen} onOpenChange={setPreviewOpen} />
    </>
  );
}
