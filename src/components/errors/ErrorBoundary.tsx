import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createErrorId, logAppError } from "@/lib/errorLog";
import { isChunkLoadError } from "@/lib/lazyWithReload";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * `app` — hele NBHub (fullskjerm-fallback).
   * `module` — én app-modul inne i skallet; skallet blir stående.
   */
  variant?: "app" | "module";
  /** Kort navn på området som feilet, brukes i logg og fallback-tekst. */
  scope?: string;
  /** Kalles når brukeren trykker «Prøv igjen». */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorId: string | null;
}

const INITIAL_STATE: ErrorBoundaryState = { error: null, errorId: null };

/**
 * Global feilgrense for NBHub.
 *
 * Fanger render-feil, lager en kort feil-ID, logger strukturert via
 * `logAppError` og viser en norsk, merkevaretilpasset fallback med
 * «Prøv igjen» og «Gå til forsiden».
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = INITIAL_STATE;

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, errorId: createErrorId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError(error, {
      scope: `boundary:${this.props.variant ?? "app"}${this.props.scope ? `:${this.props.scope}` : ""}`,
      errorId: this.state.errorId ?? undefined,
      details: { componentStack: info.componentStack?.split("\n").slice(0, 8).join("\n") },
    });
  }

  private handleReset = () => {
    this.setState(INITIAL_STATE);
    this.props.onReset?.();
  };

  private handleHome = () => {
    window.location.assign("/");
  };

  render() {
    const { error, errorId } = this.state;
    if (!error) return this.props.children;

    const isApp = (this.props.variant ?? "app") === "app";

    if (isChunkLoadError(error)) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
          <section
            role="alert"
            className="mx-auto w-full max-w-lg rounded-[14px] border border-border bg-card p-6 text-center shadow-md sm:p-8"
          >
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Ny versjon av NBHub er tilgjengelig
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Siden må lastes inn på nytt for å hente den nyeste versjonen.
            </p>
            <Button
              type="button"
              variant="brand"
              className="mt-5"
              onClick={() => window.location.reload()}
            >
              <RotateCcw aria-hidden="true" />
              <span>Last inn på nytt</span>
            </Button>
          </section>
        </div>
      );
    }


    const card = (
      <section
        role="alert"
        aria-live="assertive"
        className="mx-auto w-full max-w-lg rounded-[14px] border border-border bg-card p-6 shadow-md sm:p-8"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
          >
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              {isApp ? "Noe gikk galt i NBHub" : "Denne delen kunne ikke vises"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isApp
                ? "En uventet feil stoppet siden. Du kan prøve igjen, eller gå tilbake til forsiden."
                : "En uventet feil stoppet innholdet på denne siden. Resten av NBHub fungerer som normalt."}
            </p>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Oppgi denne feil-IDen til support:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {errorId}
          </code>
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="brand" onClick={this.handleReset} className="sm:w-auto">
            <RotateCcw aria-hidden="true" />
            <span>Prøv igjen</span>
          </Button>
          <Button type="button" variant="outline" onClick={this.handleHome} className="sm:w-auto">
            <Home aria-hidden="true" />
            <span>Gå til forsiden</span>
          </Button>
        </div>
      </section>
    );

    if (!isApp) return <div className="py-6">{card}</div>;

    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-canvas px-4 py-10">
        {card}
      </div>
    );
  }
}

export default ErrorBoundary;
