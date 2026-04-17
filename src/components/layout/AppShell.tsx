import type { ReactNode } from "react";
import { Topbar } from "./Topbar";
import { SubNav } from "./SubNav";
import { GlobalSearch } from "./GlobalSearch";
import { BugReportButton } from "./BugReportButton";
import { AppThemeProvider } from "@/providers/AppThemeProvider";
import { SelectionProvider } from "@/providers/SelectionProvider";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppThemeProvider>
      <SelectionProvider>
        <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
          <Topbar />
          <SubNav />
          <GlobalSearch />
          <main className="flex-1 overflow-y-auto px-4 py-4 md:px-6 animate-fade-in">
            {children}
          </main>
          <BugReportButton />
        </div>
      </SelectionProvider>
    </AppThemeProvider>
  );
}
