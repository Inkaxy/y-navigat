import { NavLink, useLocation } from "react-router-dom";
import * as Icons from "lucide-react";
import { Box } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  useAccessibleApps,
  type AccessibleApp,
} from "@/hooks/useAccessibleApps";
import { cn } from "@/lib/utils";

const iconMap = Icons as unknown as Record<
  string,
  React.ComponentType<{ className?: string }>
>;

/**
 * Maps apps.code → intern NBhub-route. Bare apper i denne mappen
 * vises i sidebar som intern-routes. Andre apper hoppes over.
 */
const INTERNAL_ROUTES: Record<string, string> = {
  nbhub: "/hjem",
  nbos: "/admin",
  varer: "/varer",
  kunder: "/kunder",
  ordre: "/ordre",
  produksjon: "/produksjon",
};

export function AppSidebar() {
  const { data: apps, isLoading } = useAccessibleApps();
  const { pathname } = useLocation();

  const internal = (apps ?? []).filter(
    (a) =>
      INTERNAL_ROUTES[a.slug] &&
      (a.status === "active" || a.status === "in_development"),
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Apper</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading && (
                <SidebarMenuItem>
                  <span className="px-2 py-1 text-xs text-muted-foreground">
                    Laster…
                  </span>
                </SidebarMenuItem>
              )}
              {!isLoading &&
                internal.map((app: AccessibleApp) => {
                  const to = INTERNAL_ROUTES[app.slug];
                  const Icon = iconMap[app.icon_name] ?? Box;
                  const active =
                    pathname === to || pathname.startsWith(to + "/");
                  return (
                    <SidebarMenuItem key={app.id}>
                      <SidebarMenuButton asChild isActive={active}>
                        <NavLink
                          to={to}
                          style={
                            active
                              ? {
                                  color: app.color_hex,
                                  borderLeft: `3px solid ${app.color_hex}`,
                                  background: `${app.color_hex}14`,
                                }
                              : undefined
                          }
                          className={cn("flex items-center gap-2")}
                        >
                          <Icon className="h-4 w-4" />
                          <span>{app.display_name}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
