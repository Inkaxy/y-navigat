import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/brand/Logo";
import { toast } from "sonner";

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Aktiver konto — NBhub";
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleanCode)) { toast.error("Koden må være 6 sifre"); return; }
    if (password.length < 8) { toast.error("Passord må være minst 8 tegn"); return; }
    if (password !== confirm) { toast.error("Passordene stemmer ikke"); return; }

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("redeem-invitation", {
      body: { email: email.trim().toLowerCase(), code: cleanCode, password },
    });
    if (error || (data as any)?.error) {
      setSubmitting(false);
      toast.error("Kunne ikke aktivere konto", { description: (data as any)?.error ?? error?.message });
      return;
    }

    // Logg inn med det nye passordet
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setSubmitting(false);
    if (signInErr) {
      toast.success("Konto aktivert", { description: "Logg inn med det nye passordet." });
      navigate("/login", { replace: true });
      return;
    }
    toast.success("Konto aktivert");
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <div className="flex justify-center"><Logo className="h-16 w-auto" /></div>
          <CardTitle>Aktiver konto</CardTitle>
          <CardDescription>
            Skriv inn e-postadressen din, den 6-sifrede koden fra invitasjonen, og velg et nytt passord.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-post</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="code">Aktiveringskode</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="tracking-[0.4em] text-center text-lg font-semibold"
                maxLength={9}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">Nytt passord</Label>
              <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw2">Bekreft passord</Label>
              <Input id="pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
            <Button type="submit" variant="brand" className="w-full" disabled={submitting}>
              {submitting ? "Aktiverer…" : "Aktiver konto"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Koden er gyldig i 7 dager. Mangler du den? Be administrator om å sende en ny.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
