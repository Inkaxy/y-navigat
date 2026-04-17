import { ReactNode, useState } from "react";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { BugReportButton } from "./BugReportButton";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Topbar onOpenSidebar={() => setMobileOpen(true)} />

      <div className="flex flex-1">
        <div className="hidden lg:block">
          <Sidebar />
        </div>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-60 p-0">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <main className="flex-1 overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-8 sm:py-8 animate-fade-in">
            {children}
          </div>
        </main>
      </div>

      <BugReportButton />
    </div>
  );
}
