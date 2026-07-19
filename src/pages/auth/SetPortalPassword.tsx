import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/brand/Logo";
import { toast } from "sonner";

const CUSTOMER_PORTAL_ORIGIN = "https://kundeportal.nbhub.no";

const getUrlParam = (location: Location, key: string) => {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  return search.get(key) ?? hash.get(key);
};

export default function SetPortalPassword() {
  const location = useLocation();
  const isRecovery = location.pathname.includes("tilbakestill");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const title = isRecovery ? "Velg nytt passord" : "Sett passord";
  const description = isRecovery
    ? "Velg et nytt passord for kundeportalen."
    : "Velg passord for Nøtterø Bakeri kundeportal.";

  const errorFromUrl = useMemo(() => {
    const err = getUrlParam(window.location, "error_description") ?? getUrlParam(window.location, "error");
    if (!err) return null;
    return decodeURIComponent(err.replace(/\+/g, " "));
  }, [location.key]);

  useEffect(() => {
    document.title = `${title} — Kundeportal`;
  }, [title]);

  useEffect(() => {
    let active = true;
    setChecking(true);
    setReady(false);
    setLinkError(errorFromUrl);

    const finish = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session?.user) {
        setReady(true);
        setLinkError(null);
      } else if (!errorFromUrl) {
        setLinkError("Lenken er ugyldig eller utløpt. Be administrator sende en ny invitasjon.");
      }
      setChecking(false);
    };

    const timer = window.setTimeout(finish, 350);
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !session?.user) return;
      window.clearTimeout(timer);
      setReady(true);
      setLinkError(null);
      setChecking(false);
    });

    return () => {
      active = false;
      window.clearTimeout(timer);
      listener.subscription.unsubscribe();
    };
  }, [errorFromUrl]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) {
      toast.error("Invitasjonslenken er ikke gyldig lenger");
      return;
    }
    if (password.length < 8) {
      toast.error("Passord må være minst 8 tegn");
      return;
    }
    if (password !== confirm) {
      toast.error("Passordene stemmer ikke");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast.error("Kunne ikke sette passord", { description: error.message });
      return;
    }

    toast.success("Passordet er lagret");
    await supabase.auth.signOut();
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const isPreview = window.location.hostname.endsWith("lovable.app");
    const target = isLocal || isPreview ? "/login?password_set=1" : `${CUSTOMER_PORTAL_ORIGIN}/login?password_set=1`;
    window.location.href = target;
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <div className="flex justify-center">
            <Logo className="h-16 w-auto" />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {checking ? (
            <p className="text-center text-sm text-muted-foreground">Sjekker lenken…</p>
          ) : linkError ? (
            <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <p>{linkError}</p>
              <p>Send en ny invitasjon fra Portaltilgang og bruk den nyeste e-posten.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="portal-password">Nytt passord</Label>
                <Input
                  id="portal-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portal-password-confirm">Bekreft passord</Label>
                <Input
                  id="portal-password-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" variant="brand" className="w-full" disabled={submitting}>
                {submitting ? "Lagrer…" : "Lagre passord"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}