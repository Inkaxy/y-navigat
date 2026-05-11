import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, RefreshCw, Copy, Check, Eye, EyeOff } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}

type Assignment = { legal_entity_id: string; position_id: string };

function generatePassword(length = 14) {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%&*?";
  const all = lower + upper + digits + symbols;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const required = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  const rest = Array.from({ length: length - required.length }, () => pick(all));
  return [...required, ...rest].sort(() => Math.random() - 0.5).join("");
}

export function CreateUserDialog({ open, onOpenChange, onCreated }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [showPassword, setShowPassword] = useState(true);
  const [copied, setCopied] = useState(false);
  const [assignments, setAssignments] = useState<Assignment[]>([
    { legal_entity_id: "", position_id: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setFirstName(""); setLastName(""); setEmail("");
      setPassword(generatePassword());
      setShowPassword(true);
      setCopied(false);
      setAssignments([{ legal_entity_id: "", position_id: "" }]);
      setSubmitting(false);
      setCreated(null);
    }
  }, [open]);

  const { data: companies = [] } = useQuery({
    queryKey: ["create-le-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, short_code, legal_name")
        .order("short_code");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const { data: positions = [] } = useQuery({
    queryKey: ["create-position-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("id, code, display_name, status")
        .eq("status", "active")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const updateAssignment = (idx: number, patch: Partial<Assignment>) =>
    setAssignments((p) => p.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  const addRow = () =>
    setAssignments((p) => [...p, { legal_entity_id: "", position_id: "" }]);
  const removeRow = (idx: number) =>
    setAssignments((p) => p.filter((_, i) => i !== idx));

  const copyCredentials = async (e: string, pw: string) => {
    await navigator.clipboard.writeText(`E-post: ${e}\nPassord: ${pw}`);
    setCopied(true);
    toast.success("Kopiert til utklippstavle");
    setTimeout(() => setCopied(false), 2000);
  };

  const submit = async () => {
    if (!firstName || !lastName || !email) {
      toast.error("Navn og e-post er påkrevd");
      return;
    }
    if (password.length < 8) {
      toast.error("Passord må være minst 8 tegn");
      return;
    }
    const cleaned = assignments.filter((a) => a.legal_entity_id && a.position_id);
    if (cleaned.length === 0) {
      toast.error("Minst én stilling må fylles ut");
      return;
    }
    const seen = new Set<string>();
    for (const a of cleaned) {
      const key = `${a.legal_entity_id}:${a.position_id}`;
      if (seen.has(key)) {
        toast.error("Samme stilling i samme selskap er lagt til to ganger");
        return;
      }
      seen.add(key);
    }

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("create-user-with-password", {
      body: {
        email,
        first_name: firstName,
        last_name: lastName,
        password,
        assignments: cleaned,
      },
    });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      toast.error("Oppretting mislyktes", {
        description: (data as any)?.error ?? error?.message,
      });
      return;
    }
    toast.success(`Bruker ${email} opprettet`);
    setCreated({ email, password });
    onCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Opprett ny bruker</DialogTitle>
          <DialogDescription>
            Brukeren opprettes med passord du selv setter. Du kan dele
            innloggingsinformasjonen med brukeren etterpå.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-line bg-surface-canvas p-4 space-y-2">
              <div className="text-sm font-medium">Innlogging</div>
              <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground">E-post</span>
                <span className="font-mono">{created.email}</span>
                <span className="text-muted-foreground">Passord</span>
                <span className="font-mono">{created.password}</span>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => copyCredentials(created.email, created.password)}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Kopier innloggingsinformasjon
            </Button>
            <p className="text-xs text-muted-foreground">
              Lagre eller del passordet nå — det vises ikke igjen etter at dialogen lukkes.
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Ferdig</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="c_first_name">Fornavn</Label>
                  <Input id="c_first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c_last_name">Etternavn</Label>
                  <Input id="c_last_name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c_email">E-post</Label>
                <Input id="c_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c_password">Passord</Label>
                <div className="flex gap-2">
                  <Input
                    id="c_password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="font-mono"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setShowPassword((v) => !v)} aria-label="Vis/skjul passord">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => setPassword(generatePassword())} aria-label="Generer nytt passord">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Minst 8 tegn. Du deler dette med brukeren selv.</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Stillinger</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={addRow}>
                    <Plus className="h-4 w-4" /> Legg til
                  </Button>
                </div>
                {assignments.map((a, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                    <Select value={a.legal_entity_id} onValueChange={(v) => updateAssignment(idx, { legal_entity_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Selskap" /></SelectTrigger>
                      <SelectContent>
                        {companies.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.short_code}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={a.position_id} onValueChange={(v) => updateAssignment(idx, { position_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Stilling" /></SelectTrigger>
                      <SelectContent>
                        {positions.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(idx)} disabled={assignments.length === 1} aria-label="Fjern stilling">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Første rad blir markert som primær stilling.</p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Avbryt
              </Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? "Oppretter…" : "Opprett bruker"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
