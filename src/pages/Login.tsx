import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { UserCircle2 } from "lucide-react";

const DEMO_PASSWORD = "Demo2026!";

const DEMO_USERS: Array<{
  email: string;
  name: string;
  role: string;
  entity: string;
}> = [
  {
    email: "anne.hansen@demo.no",
    name: "Anne Hansen",
    role: "Butikkleder",
    entity: "Inka Bakeri (IB)",
  },
  {
    email: "per.olsen@demo.no",
    name: "Per Olsen",
    role: "Baker",
    entity: "Nøtterø Bakeri (NB)",
  },
];

export default function Login() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) navigate("/hjem", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    document.title = "Logg inn — NBHub";
  }, []);

  const signIn = async (loginEmail: string, loginPassword: string) => {
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Innlogging mislyktes", { description: error.message });
      return;
    }
    navigate("/hjem", { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signIn(email, password);
  };

  const handleDemoLogin = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    await signIn(demoEmail, DEMO_PASSWORD);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 animate-fade-in">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-foreground">NB</span>
            <span className="text-primary">Hub</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Nøtterø Bakeri-konsernet</p>
        </div>

        <Card className="shadow-elevated">
          <CardHeader>
            <CardTitle>Logg inn</CardTitle>
            <CardDescription>Bruk din arbeidsadresse og passord.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-post</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="navn@notterobakeri.no"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Passord</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Logger inn…" : "Logg inn"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Demo-brukere</CardTitle>
            <CardDescription className="text-xs">
              Klikk for å logge inn som testbruker. Kun for demonstrasjon.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {DEMO_USERS.map((u) => (
              <button
                key={u.email}
                type="button"
                onClick={() => handleDemoLogin(u.email)}
                disabled={submitting}
                className="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <UserCircle2 className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{u.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{u.role}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{u.entity}</div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Glemt passord? Ta kontakt med plattform-ansvarlig.
        </p>
      </div>
    </div>
  );
}
