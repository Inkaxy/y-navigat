import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import { logAppError } from "@/lib/errorLog";

const MIN_LENGTH = 10;

type Phase = "checking" | "ready" | "invalid" | "done";

/**
 * Setter nytt passord for en innlogget recovery-session (lenke fra
 * «Glemt passord»). Supabase-klienten bytter inn koden i URL-en
 * automatisk (`detectSessionInUrl`), så her venter vi bare på at
 * sesjonen finnes før skjemaet vises.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Nytt passord — NBHub";
  }, []);

  useEffect(() => {
    let cancelled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session) setPhase((prev) => (prev === "done" ? prev : "ready"));
    });

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        setPhase((prev) => (prev === "done" ? prev : session ? "ready" : "invalid"));
      })
      .catch((err) => {
        if (cancelled) return;
        logAppError(err, { scope: "auth:reset-password-session" });
        setPhase("invalid");
      });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Passordet må være minst ${MIN_LENGTH} tegn.`);
      return;
    }
    if (password !== confirm) {
      setError("Passordene er ikke like.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      logAppError(updateError, { scope: "auth:update-password" });
      setError("Kunne ikke lagre nytt passord. Lenken kan være utløpt — be om en ny og prøv igjen.");
      return;
    }

    setPhase("done");
  };

  const footer = (
    <p>
      <Link
        to="/login"
        className="rounded-sm font-medium text-brand-bronze underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Tilbake til innlogging
      </Link>
    </p>
  );

  if (phase === "checking") {
    return (
      <AuthShell title="Nytt passord" description="Kontrollerer lenken…" footer={footer}>
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          <div className="h-10 animate-pulse rounded-[10px] bg-muted" />
          <div className="h-10 animate-pulse rounded-[10px] bg-muted" />
          <div className="h-10 animate-pulse rounded-[10px] bg-muted" />
        </div>
      </AuthShell>
    );
  }

  if (phase === "invalid") {
    return (
      <AuthShell
        title="Lenken er ikke gyldig"
        description="Lenken kan være brukt opp eller utløpt."
        footer={footer}
      >
        <div className="space-y-4" role="status" aria-live="polite">
          <p className="text-sm text-muted-foreground">
            Be om en ny lenke for å sette passord. Den forrige slutter å virke så snart den er brukt.
          </p>
          <Button asChild variant="brand" className="w-full">
            <Link to="/glemt-passord">Be om ny lenke</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (phase === "done") {
    return (
      <AuthShell
        title="Passordet er oppdatert"
        description="Du er logget inn og kan fortsette i NBHub."
        footer={footer}
      >
        <div className="space-y-4" role="status" aria-live="polite">
          <div className="flex items-start gap-3 rounded-[12px] border border-border bg-muted/40 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-bronze" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Bruk det nye passordet neste gang du logger inn.
            </p>
          </div>
          <Button type="button" variant="brand" className="w-full" onClick={() => navigate("/", { replace: true })}>
            Gå til NBHub
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Sett nytt passord"
      description={`Velg et passord på minst ${MIN_LENGTH} tegn.`}
      footer={footer}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="new-password">Nytt passord</Label>
          <Input
            id="new-password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={error ? "reset-error" : undefined}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password">Gjenta nytt passord</Label>
          <Input
            id="confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-describedby={error ? "reset-error" : undefined}
          />
        </div>

        {error ? (
          <p id="reset-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="brand" className="w-full" disabled={submitting}>
          {submitting ? "Lagrer…" : "Lagre nytt passord"}
        </Button>
      </form>
    </AuthShell>
  );
}
