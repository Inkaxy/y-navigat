import type { ReactNode } from "react";
import { AppColorProvider } from "@/providers/AppColorProvider";
import { SelectionProvider } from "@/providers/SelectionProvider";
import { Topbar } from "./Topbar";
import { SubAppNav } from "./SubAppNav";
import { BugReportButton } from "./BugReportButton";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppColorProvider appCode="nbhub">
      <SelectionProvider>
        <div className="app-shell flex min-h-screen w-full flex-col bg-surface-canvas text-ink-primary">
          <Topbar />
          <SubAppNav />
          <main className="flex-1">
            <div
              className="page-canvas mx-auto w-full animate-fade-in px-4 pb-10 pt-5 sm:px-6 sm:pt-6 md:px-8 md:pb-12 md:pt-8"
              style={{ maxWidth: "1280px" }}
            >
              {children}
            </div>
          </main>
          <BugReportButton />
        </div>
      </SelectionProvider>
    </AppColorProvider>
  );
}
