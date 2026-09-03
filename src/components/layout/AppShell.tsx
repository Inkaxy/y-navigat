import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AppColorProvider } from "@/providers/AppColorProvider";
import { SelectionProvider } from "@/providers/SelectionProvider";
import { ErrorBoundary } from "@/components/errors/ErrorBoundary";
import { resolveAppCodeFromPath } from "@/lib/activeApp";
import { Topbar } from "./Topbar";
import { SubAppNav } from "./SubAppNav";
import { BugReportButton } from "./BugReportButton";
import { MobileBottomNav } from "@/ordre/components/shell/MobileBottomNav";

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isOrdre = pathname === "/ordre" || pathname.startsWith("/ordre/");
  const appCode = resolveAppCodeFromPath(pathname);

  return (
    <AppColorProvider appCode={appCode}>
      <SelectionProvider>
        <div className="app-shell flex min-h-screen w-full flex-col bg-surface-canvas text-ink-primary">
          <a
            href="#main-content"
            className="sr-only rounded-[10px] bg-brand-ink px-4 py-2 text-sm font-medium text-brand-cream shadow-lg focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:outline-none focus:ring-2 focus:ring-brand-bronze focus:ring-offset-2 focus:ring-offset-brand-ink"
          >
            Hopp til hovedinnhold
          </a>

          <Topbar />
          <SubAppNav />
          <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
            <div
              className={`page-canvas mx-auto w-full animate-fade-in px-4 pt-5 sm:px-6 sm:pt-6 md:px-8 md:pt-8 safe-px ${
                isOrdre ? "pb-mobile-nav md:pb-12" : "pb-10 md:pb-12"
              }`}
              style={{ maxWidth: "1280px" }}
            >
              {/* Lokal feilgrense: én app-modul skal ikke ta ned hele NBHub-skallet.
                  `key` på pathname nullstiller feilen når brukeren navigerer videre. */}
              <ErrorBoundary key={pathname} variant="module" scope={appCode}>
                {children}
              </ErrorBoundary>
            </div>
          </main>
          {isOrdre && <MobileBottomNav />}
          <BugReportButton />
        </div>
      </SelectionProvider>
    </AppColorProvider>
  );
}
