import type { ReactNode } from "react";
import { AppColorProvider } from "@/providers/AppColorProvider";
import { SelectionProvider } from "@/providers/SelectionProvider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Topbar } from "./Topbar";
import { SubNav } from "./SubNav";
import { BugReportButton } from "./BugReportButton";
import { AppSidebar } from "./AppSidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppColorProvider appCode="nbhub">
      <SelectionProvider>
        <SidebarProvider>
          <div className="app-shell flex min-h-screen w-full flex-col bg-surface-canvas text-ink-primary">
            <Topbar />
            <SubNav />
            <div className="flex flex-1 w-full">
              <AppSidebar />
              <div className="flex flex-1 flex-col">
                <div className="flex h-10 items-center border-b border-line bg-surface-canvas px-2">
                  <SidebarTrigger />
                </div>
                <main className="flex-1">
                  <div
                    className="page-canvas mx-auto w-full animate-fade-in"
                    style={{ maxWidth: "1280px", padding: "32px 32px 48px" }}
                  >
                    {children}
                  </div>
                </main>
              </div>
            </div>
            <BugReportButton />
          </div>
        </SidebarProvider>
      </SelectionProvider>
    </AppColorProvider>
  );
}
