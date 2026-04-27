import type { ReactNode } from "react";
import { AppColorProvider } from "@/providers/AppColorProvider";
import { SelectionProvider } from "@/providers/SelectionProvider";
import { Topbar } from "./Topbar";
import { SubNav } from "./SubNav";
import { BugReportButton } from "./BugReportButton";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppColorProvider appCode="nbhub">
      <SelectionProvider>
        <div className="app-shell flex min-h-screen flex-col bg-surface-canvas text-ink-primary">
          <Topbar />
          <SubNav />
          <main className="flex-1">
            <div
              className="page-canvas mx-auto w-full animate-fade-in"
              style={{ maxWidth: "1280px", padding: "32px 32px 48px" }}
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
