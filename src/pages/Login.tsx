import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { AuthShell } from "@/components/auth/AuthShell";
import { logAppError } from "@/lib/errorLog";

const ALLOWED_RETURN_HOSTS = /^https:\/\/([a-z0-9-]+\.)?nbhub\.no(\/|$)/;

const resolveReturnTarget = (raw: string | null): string | null => {
  if (!raw) return null;
  return ALLOWED_RETURN_HOSTS.test(raw) ? raw : null;
};

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const goAfterLogin = () => {
    const target = resolveReturnTarget(params.get("return"));
    if (target) {
      window.location.href = target;
    } else {
      navigate("/", { replace: true });
    }
  };

  useEffect(() => {
    if (!user) return;
    const target = resolveReturnTarget(params.get("return"));
    if (target) {
      window.location.href = target;
    } else {
      navigate("/", { replace: true });
    }
  }, [user, navigate, params]);

  useEffect(() => {
    document.title = "Logg inn — NBHub";
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);

    if (error) {
      // Rå Supabase-meldinger skal aldri vises til sluttbruker.
      logAppError(error, { scope: "auth:sign-in" });
      toast.error("Innlogging mislyktes", {
        description: "Kontrollér e-postadresse og passord, og prøv igjen.",
      });
      return;
    }

    goAfterLogin();
  };

  return (
    <AuthShell
      title="Logg inn"
      description="Bruk arbeidsadressen din og passordet ditt."
      footer={
        <p>
          Problemer med innlogging? Ta kontakt med plattform-ansvarlig.
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-post</Label>
          <Input
            id="email"
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

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="password">Passord</Label>
            <Link
              to="/glemt-passord"
              className="rounded-sm text-xs font-medium text-brand-bronze underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Glemt passord?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" variant="brand" className="w-full" disabled={submitting}>
          {submitting ? "Logger inn…" : "Logg inn"}
        </Button>
      </form>
    </AuthShell>
  );
}
