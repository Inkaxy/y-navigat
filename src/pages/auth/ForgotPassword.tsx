import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import { logAppError } from "@/lib/errorLog";

/**
 * «Glemt passord» for ansatte i NBHub.
 *
 * Sender en gjenopprettingslenke via Supabase Auth med redirect til
 * `/tilbakestill-passord` på samme origin. Av hensyn til personvern viser
 * siden alltid samme kvittering — vi bekrefter aldri om en e-postadresse
 * finnes. Tekniske feil logges via `logAppError`.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.title = "Glemt passord — NBHub";
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/tilbakestill-passord`,
    });

    if (error) {
      logAppError(error, { scope: "auth:reset-password-email" });
    }

    // Samme kvittering uansett utfall — hindrer at siden avslører hvilke
    // adresser som finnes.
    setSubmitting(false);
    setSent(true);
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

  if (sent) {
    return (
      <AuthShell
        title="Sjekk e-posten din"
        description="Hvis adressen er registrert i NBHub, har vi sendt en lenke for å sette nytt passord."
        footer={footer}
      >
        <div className="space-y-4" role="status" aria-live="polite">
          <div className="flex items-start gap-3 rounded-[12px] border border-border bg-muted/40 p-4">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-bronze" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Lenken er gyldig en kort stund. Finner du den ikke, sjekk søppelpost — eller be om en ny
              lenke.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setSent(false)}
          >
            Send lenken på nytt
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Glemt passord"
      description="Skriv inn arbeidsadressen din, så sender vi en lenke for å sette nytt passord."
      footer={footer}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="reset-email">E-post</Label>
          <Input
            id="reset-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="navn@notterobakeri.no"
          />
        </div>

        <Button type="submit" variant="brand" className="w-full" disabled={submitting}>
          {submitting ? "Sender lenke…" : "Send lenke for nytt passord"}
        </Button>
      </form>
    </AuthShell>
  );
}
