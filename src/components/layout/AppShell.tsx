import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AppColorProvider } from "@/providers/AppColorProvider";
import { SelectionProvider } from "@/providers/SelectionProvider";
import { Topbar } from "./Topbar";
import { SubAppNav } from "./SubAppNav";
import { BugReportButton } from "./BugReportButton";
import { MobileBottomNav } from "@/ordre/components/shell/MobileBottomNav";

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isOrdre = pathname === "/ordre" || pathname.startsWith("/ordre/");

  return (
    <AppColorProvider appCode="nbhub">
      <SelectionProvider>
        <div className="app-shell flex min-h-screen w-full flex-col bg-surface-canvas text-ink-primary">
          <Topbar />
          <SubAppNav />
          <main className="flex-1">
            <div
              className={`page-canvas mx-auto w-full animate-fade-in px-4 pt-5 sm:px-6 sm:pt-6 md:px-8 md:pt-8 safe-px ${
                isOrdre ? "pb-mobile-nav md:pb-12" : "pb-10 md:pb-12"
              }`}
              style={{ maxWidth: "1280px" }}
            >
              {children}
            </div>
          </main>
          {isOrdre && <MobileBottomNav />}
          <BugReportButton />
        </div>
      </SelectionProvider>
    </AppColorProvider>
  );
}
