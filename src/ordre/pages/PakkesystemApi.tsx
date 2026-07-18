import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  usePakkesystemKeys,
  useCreatePakkesystemKey,
  useRevokePakkesystemKey,
  usePakkesystemLog,
} from "@/ordre/hooks/usePakkesystemKeys";
import { formatDateTime, formatRelative } from "@/ordre/lib/format";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const BASE = `${SUPABASE_URL}/functions/v1/pakkesystem-api`;

export default function PakkesystemApiPage() {
  const { data: keys = [], isLoading } = usePakkesystemKeys();
  const { data: log = [] } = usePakkesystemLog();
  const create = useCreatePakkesystemKey();
  const revoke = useRevokePakkesystemKey();
  const { toast } = useToast();

  const [newName, setNewName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const res = await create.mutateAsync(newName.trim());
    setPlaintext(res.plaintext);
    setNewName("");
    setCreateOpen(false);
  };

  const copy = (v: string) => {
    navigator.clipboard.writeText(v);
    toast({ title: "Kopiert" });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pakkesystem-API</h1>
        <p className="text-sm text-muted-foreground">
          Utleveringspunkt for eksternt pakkesystem — REST-endepunkter med langlevd Bearer-nøkkel.
        </p>
      </div>

      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys">Nøkler</TabsTrigger>
          <TabsTrigger value="endpoints">Endepunkter</TabsTrigger>
          <TabsTrigger value="log">Aktivitet</TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">API-nøkler</h2>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Ny nøkkel
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Laster…</div>
              ) : keys.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  Ingen nøkler ennå. Opprett en for å gi pakkesystem-leverandøren tilgang.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3">Navn</th>
                      <th className="p-3">Prefix</th>
                      <th className="p-3">Opprettet</th>
                      <th className="p-3">Sist brukt</th>
                      <th className="p-3">Status</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id} className="border-b last:border-0">
                        <td className="p-3 font-medium">{k.name}</td>
                        <td className="p-3 font-mono text-xs">{k.key_prefix}…</td>
                        <td className="p-3 text-muted-foreground">{formatDateTime(k.created_at)}</td>
                        <td className="p-3 text-muted-foreground">
                          {k.last_used_at ? formatRelative(k.last_used_at) : "—"}
                        </td>
                        <td className="p-3">
                          {k.revoked_at ? (
                            <Badge variant="secondary">Trukket tilbake</Badge>
                          ) : (
                            <Badge>Aktiv</Badge>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {!k.revoked_at && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Trekke tilbake "${k.name}"? Denne handlingen kan ikke angres.`)) {
                                  revoke.mutate(k.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="endpoints" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Endepunkter</CardTitle>
              <CardDescription>Alle kall krever <code>Authorization: Bearer &lt;nøkkel&gt;</code>.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {[
                { m: "GET", p: "/snapshot?date=YYYY-MM-DD", d: "Full snapshot per spec (schema_version 1.0)" },
                { m: "GET", p: "/orders?from=YYYY-MM-DD&to=YYYY-MM-DD", d: "Ordre i periode" },
                { m: "GET", p: "/products", d: "Produktkatalog" },
                { m: "GET", p: "/customers", d: "Kundeliste" },
              ].map((e) => (
                <div key={e.p} className="flex items-start gap-3 rounded-md border p-3">
                  <Badge variant="outline" className="mt-0.5">{e.m}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="truncate text-xs">{BASE}{e.p}</code>
                      <Button size="icon" variant="ghost" onClick={() => copy(`${BASE}${e.p}`)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">{e.d}</div>
                  </div>
                </div>
              ))}
              <div className="rounded-md bg-muted p-3 font-mono text-xs">
                curl -H "Authorization: Bearer psk_..." \{"\n"}
                {"  "}"{BASE}/snapshot?date=2026-07-19"
              </div>
              <div className="flex gap-2">
                <a href="/pakkesystem/schema.json" target="_blank" rel="noopener" className="text-primary underline">
                  JSON Schema
                </a>
                <span className="text-muted-foreground">·</span>
                <a href="/pakkesystem/openapi.yaml" target="_blank" rel="noopener" className="text-primary underline">
                  OpenAPI
                </a>
                <span className="text-muted-foreground">·</span>
                <a href="/pakkesystem/example-snapshot.json" target="_blank" rel="noopener" className="text-primary underline">
                  Eksempel-snapshot
                </a>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>Rate-limit: 60 requests per minutt per nøkkel (429 ved overskridelse).</li>
                <li>Feilkoder: 400 <code>invalid_params</code>, 401 <code>invalid_key</code>, 404, 429, 500.</li>
                <li>Full snapshot per dag — ingen deltaer. UTF-8, ISO 8601.</li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="log" className="space-y-4 pt-4">
          <Card>
            <CardContent className="p-0">
              {log.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">Ingen kall registrert enda.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-3">Tid</th>
                      <th className="p-3">Endepunkt</th>
                      <th className="p-3">Params</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Rader</th>
                      <th className="p-3">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="p-3 text-muted-foreground">{formatDateTime(r.created_at)}</td>
                        <td className="p-3 font-mono text-xs">{r.endpoint}</td>
                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {r.query_params ? JSON.stringify(r.query_params) : "—"}
                        </td>
                        <td className="p-3">
                          <Badge variant={r.status_code >= 400 ? "destructive" : "secondary"}>{r.status_code}</Badge>
                        </td>
                        <td className="p-3">{r.row_count ?? "—"}</td>
                        <td className="p-3 text-muted-foreground">{r.ip ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Opprett-dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ny API-nøkkel</DialogTitle>
            <DialogDescription>Gi nøkkelen et beskrivende navn (f.eks. leverandørens systemnavn).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="key-name">Navn</Label>
            <Input
              id="key-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Bakemann pakkesystem"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Avbryt</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || create.isPending}>
              <KeyRound className="mr-2 h-4 w-4" /> Opprett
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vis plaintext én gang */}
      <Dialog open={!!plaintext} onOpenChange={(o) => !o && setPlaintext(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Kopier nøkkelen nå
            </DialogTitle>
            <DialogDescription>
              Denne nøkkelen vises kun én gang. Kopier den og send til pakkesystem-leverandøren gjennom en sikker kanal.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
            <code className="flex-1 break-all text-xs">{plaintext}</code>
            <Button size="sm" onClick={() => plaintext && copy(plaintext)}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Kopier
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setPlaintext(null)}>Jeg har kopiert nøkkelen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
