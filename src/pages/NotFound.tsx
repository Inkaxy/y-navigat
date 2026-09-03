import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Compass, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/Logo";

export default function NotFound() {
  const location = useLocation();

  useEffect(() => {
    document.title = "Siden finnes ikke — NBHub";
    // eslint-disable-next-line no-console
    console.warn("[nbhub:404] Ukjent rute:", location.pathname);
  }, [location.pathname]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-canvas px-4 py-10 safe-px">
      <section className="w-full max-w-md animate-fade-in rounded-[14px] border border-border bg-card p-6 text-center shadow-md sm:p-8">
        <div className="flex justify-center">
          <Logo variant="monogram" className="h-16 w-auto text-brand-ink" title="Nøtterø Bakeri" />
        </div>

        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          404
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Siden finnes ikke
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Adressen{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {location.pathname}
          </code>{" "}
          finnes ikke i NBHub. Den kan ha blitt flyttet eller fjernet.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild variant="brand">
            <Link to="/">
              <Home aria-hidden="true" />
              <span>Gå til forsiden</span>
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/hjelp">
              <Compass aria-hidden="true" />
              <span>Åpne hjelp</span>
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
