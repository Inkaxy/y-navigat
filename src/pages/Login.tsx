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

        <p className="text-center text-xs text-muted-foreground">
          Glemt passord? Ta kontakt med plattform-ansvarlig.
        </p>
      </div>
    </div>
  );
}
