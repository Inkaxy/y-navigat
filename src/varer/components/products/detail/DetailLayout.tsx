import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Save, X, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PRODUCT_STATUS_LABEL, ProductStatus } from "@/lib/constants";
import { TabNavItem, type TabConfig } from "./TabNavItem";

interface DetailLayoutProps {
  product: {
    id: string;
    display_name: string;
    display_number: number;
    code: string;
    status: ProductStatus;
    variant_of_product_id: string | null;
  };
  tabs: TabConfig[];
  activeTab: string;
  onTabChange: (id: string) => void;
  dirtyTabs: Set<string>;
  errorTabs: Set<string>;
  isDirty: boolean;
  saving: boolean;
  canWrite: boolean;
  onSave: () => void;
  onCancel: () => void;
  onDeactivate: () => void;
  children: ReactNode;
}

export function DetailLayout({
  product,
  tabs,
  activeTab,
  onTabChange,
  dirtyTabs,
  errorTabs,
  isDirty,
  saving,
  canWrite,
  onSave,
  onCancel,
  onDeactivate,
  children,
}: DetailLayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="px-4 sm:px-6 py-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/vareliste")}
        className="mb-3 -ml-2"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Tilbake til vareliste
      </Button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight truncate">
              {product.display_name}
            </h1>
            <Badge variant="outline">{PRODUCT_STATUS_LABEL[product.status]}</Badge>
            {product.variant_of_product_id && (
              <Badge className="bg-app/15 text-app-dark hover:bg-app/15">Variant</Badge>
            )}
            {isDirty && (
              <span className="text-xs text-warning font-medium">• Usavete endringer</span>
            )}
          </div>
          <div className="mt-1 text-sm text-muted-foreground font-mono">
            #{product.display_number} · {product.code}
          </div>
        </div>

        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {product.status !== "discontinued" && (
              <Button
                variant="outline"
                size="sm"
                onClick={onDeactivate}
                className="text-destructive hover:text-destructive"
              >
                <Ban className="mr-1.5 h-4 w-4" /> De-aktiver
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={!isDirty || saving}
            >
              <X className="mr-1.5 h-4 w-4" /> Avbryt
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={!isDirty || saving}
              className="bg-app hover:bg-app-dark text-app-foreground"
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" />
              )}
              Lagre
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        {/* Sidebar — vertical desktop, horisontal scroll mobil */}
        <nav
          className={cn(
            "shrink-0 md:w-[220px]",
            "md:border md:border-border md:rounded-md md:bg-card md:p-1.5",
            "border-b border-border md:border-b",
          )}
        >
          <ul
            className={cn(
              "flex md:flex-col gap-0.5",
              "overflow-x-auto md:overflow-visible",
              "pb-1 md:pb-0",
            )}
          >
            {tabs.map((t) =>
              t.type === "separator" ? (
                <li key={t.id} className="hidden md:block px-2 py-1.5">
                  <div className="h-px bg-border" />
                </li>
              ) : (
                <li key={t.id} className="shrink-0">
                  <TabNavItem
                    tab={t}
                    active={activeTab === t.id}
                    dirty={dirtyTabs.has(t.id)}
                    error={errorTabs.has(t.id)}
                    onClick={() => onTabChange(t.id)}
                  />
                </li>
              ),
            )}
          </ul>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
