import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMyPositions } from "@/hooks/useMyPositions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AppHeaderBanner } from "@/components/layout/AppHeaderBanner";
import { User, Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type ThemeMode } from "@/providers/ThemeProvider";
import { cn } from "@/lib/utils";

export default function MinProfil() {
  const { data: profile, isLoading } = useCurrentUser();
  const { data: positions } = useMyPositions();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    display_name: "",
    first_name: "",
    last_name: "",
    phone: "",
    avatar_url: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = "Min profil — NBHub";
  }, []);

  useEffect(() => {
    if (profile) {
      setForm({
        display_name: profile.display_name ?? "",
        first_name: profile.first_name ?? "",
        last_name: profile.last_name ?? "",
        phone: profile.phone ?? "",
        avatar_url: profile.avatar_url ?? "",
      });
    }
  }, [profile]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase
      .from("users")
      .update({
        display_name: form.display_name,
        first_name: form.first_name || null,
        last_name: form.last_name || null,
        phone: form.phone || null,
        avatar_url: form.avatar_url || null,
      })
      .eq("id", profile.id);
    setSaving(false);
    if (error) {
      if (import.meta.env.DEV) console.warn("[profile] save failed:", error.message);
      toast.error("Kunne ikke lagre", { description: "Noe gikk galt, prøv igjen." });
      return;
    }
    toast.success("Profil oppdatert");
    qc.invalidateQueries({ queryKey: ["current-user"] });
  };

  if (isLoading) {
    return <Skeleton className="h-96" />;
  }

  const initials = form.display_name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-6">
      <AppHeaderBanner
        icon={User}
        title="Min profil"
        subtitle="Oppdater dine kontaktopplysninger og se dine stillinger."
      />

      <Card>
        <CardHeader>
          <CardTitle>Bruker-info</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-5">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={form.avatar_url} />
                <AvatarFallback className="bg-primary/10 text-primary">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-2">
                <Label htmlFor="avatar">Avatar URL</Label>
                <Input
                  id="avatar"
                  value={form.avatar_url}
                  onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="display_name">Visningsnavn</Label>
                <Input
                  id="display_name"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-post</Label>
                <Input id="email" value={profile?.email ?? ""} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="first_name">Fornavn</Label>
                <Input
                  id="first_name"
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Etternavn</Label>
                <Input
                  id="last_name"
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="phone">Telefon</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>

            <Button type="submit" disabled={saving}>
              {saving ? "Lagrer…" : "Lagre endringer"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ThemePreferenceCard />

      <Card>
        <CardHeader>
          <CardTitle>Mine stillinger</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!positions?.length && (
            <p className="text-sm text-muted-foreground">Ingen stillinger registrert.</p>
          )}
          {positions?.map((p: any) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.position?.display_name}</span>
                  {p.is_primary && (
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/15">Primær</Badge>
                  )}
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>Fra: {p.valid_from ? format(new Date(p.valid_from), "dd.MM.yyyy") : "—"}</div>
                <div>Til: {p.valid_to ? format(new Date(p.valid_to), "dd.MM.yyyy") : "Løpende"}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ThemePreferenceCard() {
  const { mode, setMode } = useTheme();
  const options: { value: ThemeMode; label: string; desc: string; icon: typeof Sun }[] = [
    { value: "dark", label: "Mørkt", desc: "Standard for nye brukere", icon: Moon },
    { value: "light", label: "Lyst", desc: "Klassisk lys flate", icon: Sun },
    { value: "system", label: "System", desc: "Følger operativsystem", icon: Monitor },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Utseende</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Velg standard tema for kontoen din. Valget lagres i nettleseren.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {options.map((opt) => {
            const Icon = opt.icon;
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all",
                  active
                    ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                    : "border-border hover:border-primary/40 hover:bg-accent",
                )}
              >
                <Icon className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
