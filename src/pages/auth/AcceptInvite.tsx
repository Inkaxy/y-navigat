import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/brand/Logo";
import { toast } from "sonner";

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Aktiver konto — NBHub";
    // Supabase sets session from #access_token in URL automatically (detectSessionInUrl)
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error("Passord må være minst 8 tegn"); return; }
    if (password !== confirm) { toast.error("Passordene stemmer ikke"); return; }
    setSubmitting(true);
    const { error: pwErr } = await supabase.auth.updateUser({ password });
    if (pwErr) {
      setSubmitting(false);
      toast.error("Kunne ikke sette passord", { description: pwErr.message });
      return;
    }
    // Mark profile active
    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      await supabase.from("users").update({ status: "active", onboarded_at: new Date().toISOString() }).eq("id", u.user.id);
    }
    setSubmitting(false);
    toast.success("Konto aktivert");
    navigate("/hjem", { replace: true });
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <div className="flex justify-center"><Logo className="h-16 w-auto" /></div>
          <CardTitle>Aktiver konto</CardTitle>
          <CardDescription>
            {hasSession ? "Sett et passord for å fullføre invitasjonen." : "Invitasjonslenken er ugyldig eller utløpt."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasSession ? (
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pw">Passord</Label>
                <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw2">Bekreft passord</Label>
                <Input id="pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <Button type="submit" variant="brand" className="w-full" disabled={submitting}>
                {submitting ? "Lagrer…" : "Aktiver konto"}
              </Button>
            </form>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => navigate("/login")}>
              Til innlogging
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
