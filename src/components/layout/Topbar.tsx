import { HelpCircle, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccessibleApps } from "@/hooks/useAccessibleApps";
import { CompanySelector } from "./CompanySelector";
import { OutletSelector } from "./OutletSelector";
import { AppSwitcher } from "@/components/AppSwitcher";

// Must match CURRENT_APP_SLUG in AppSwitcher.tsx — kept local for the
// underline color so topbar stays self-contained per app copy.
const CURRENT_APP_SLUG = "nbhub";
const FALLBACK_COLOR = "#64748b";

export function Topbar() {
  const { signOut } = useAuth();
  const { data: profile } = useCurrentUser();
  const { data: apps } = useAccessibleApps();
  const navigate = useNavigate();

  const displayName = profile?.display_name ?? profile?.email ?? "Bruker";
  const currentApp = apps?.find((a) => a.slug === CURRENT_APP_SLUG);
  const appColor = currentApp?.color_hex ?? FALLBACK_COLOR;

  return (
    <header
      className="relative flex h-12 items-center justify-between gap-2 border-b bg-background px-3 text-foreground"
      style={{ borderBottomColor: appColor, borderBottomWidth: "2px" }}
    >
      {/* Venstre: selskap */}
      <div className="flex min-w-0 items-center">
        <CompanySelector />
      </div>

      {/* Senter: app-switcher */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <AppSwitcher />
      </div>

      {/* Høyre: outlet, bruker, hjelp, logg ut */}
      <div className="flex items-center gap-2">
        <OutletSelector />

        <span className="hidden max-w-[140px] truncate text-sm font-medium sm:inline">
          {displayName}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => navigate("/hjelp")}
              aria-label="Hjelp"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Hjelp og dokumentasjon</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={signOut}
              aria-label="Logg ut"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Logg ut</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
