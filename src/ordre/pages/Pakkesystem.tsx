import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Copy, Download, Key, PlusCircle, Trash2, Zap, ExternalLink, Clock, CheckCircle2, XCircle, SlidersHorizontal, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { SettKriteriaDialog } from "@/produksjon/features/produksjonsplan/components/SettKriteriaDialog";
import { DEFAULT_CRITERIA, type ProduksjonsplanCriteria } from "@/produksjon/features/produksjonsplan/types";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/** Hva en API-nøkkel gir tilgang til. */
export type KeyScope = "pakkesystem" | "declarations";

export const KEY_SCOPE_LABEL: Record<KeyScope, string> = {
  pakkesystem: "Pakkesystem",
  declarations: "Deklarasjoner",
};

function criteriaToQuery(c: ProduksjonsplanCriteria): string {
  const qs = new URLSearchParams();
  if (c.tour_numbers?.length) qs.set("tours", c.tour_numbers.join(","));
  if (c.main_category_ids?.length) qs.set("main_categories", c.main_category_ids.join(","));
  if (c.sub_category_ids?.length) qs.set("sub_categories", c.sub_category_ids.join(","));
  if (c.include_products_without_subcategory === false) qs.set("include_no_sub", "0");
  if (c.customer_group_ids?.length) qs.set("customer_groups", c.customer_group_ids.join(","));
  const s = qs.toString();
  return s ? `&${s}` : "";
}

function criteriaSummary(c: ProduksjonsplanCriteria): string {
  const parts: string[] = [];
  if (c.tour_numbers?.length) parts.push(`Tur ${c.tour_numbers.join(",")}`);
  else parts.push("Alle turer");
  if (c.main_category_ids?.length) parts.push(`${c.main_category_ids.length} hovedgrp.`);
  if (c.sub_category_ids?.length) parts.push(`${c.sub_category_ids.length} undergrp.`);
  if (c.customer_group_ids?.length) parts.push(`${c.customer_group_ids.length} kundegrp.`);
  return parts.join(" · ");
}


function NotesReadyBadge({ date }: { date: string }) {
  const q = useQuery({
    queryKey: ["pakkesystem-notes-ready", date],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("delivery_notes")
        .select("id", { count: "exact", head: true })
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("delivery_date", date)
        .neq("status", "cancelled");
      if (error) throw error;
      return count ?? 0;
    },
  });
  if (q.isLoading) return <Badge variant="outline">Sjekker…</Badge>;
  if ((q.data ?? 0) === 0) {
    return <Badge variant="destructive">Pakksedler ikke generert</Badge>;
  }
  return <Badge variant="secondary">{q.data} pakksedler klare</Badge>;
}

export default function PakkesystemPage() {
  const qc = useQueryClient();
  const [downloadDate, setDownloadDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyNote, setNewKeyNote] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<Record<KeyScope, boolean>>({
    pakkesystem: true,
    declarations: false,
  });
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const [downloadCriteria, setDownloadCriteria] = useState<ProduksjonsplanCriteria>(DEFAULT_CRITERIA);
  const [downloadCriteriaOpen, setDownloadCriteriaOpen] = useState(false);
  const [destCriteriaFor, setDestCriteriaFor] = useState<string | null>(null);
  const [newDestCriteria, setNewDestCriteria] = useState<ProduksjonsplanCriteria>(DEFAULT_CRITERIA);
  const [newDestCriteriaOpen, setNewDestCriteriaOpen] = useState(false);

  const [destOpen, setDestOpen] = useState(false);
  const [destForm, setDestForm] = useState({
    name: "",
    url: "",
    push_time: "04:00",
    target_offset_days: 0,
    auth_header: "",
  });

  const keys = useQuery({
    queryKey: ["pakkesystem-keys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pakkesystem_api_keys")
        .select("id, name, note, key_prefix, scopes, created_at, last_used_at, revoked_at")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const dests = useQuery({
    queryKey: ["pakkesystem-dests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pakkesystem_push_destinations")
        .select("*")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("push_time");
      if (error) throw error;
      return data;
    },
  });

  const logs = useQuery({
    queryKey: ["pakkesystem-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pakkesystem_api_log")
        .select("id, endpoint, status_code, row_count, ip, ua, created_at, api_key_id")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const createKey = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("pakkesystem-create-key", {
        body: {
          legal_entity_id: NB_LEGAL_ENTITY_ID,
          name: newKeyName,
          note: newKeyNote || null,
          scopes: (Object.keys(newKeyScopes) as KeyScope[]).filter((s) => newKeyScopes[s]),
        },
      });
      if (error) throw error;
      return data as { id: string; api_key: string; name: string };
    },
    onSuccess: (data) => {
      setRevealedKey(data.api_key);
      setNewKeyName("");
      setNewKeyNote("");
      setNewKeyScopes({ pakkesystem: true, declarations: false });
      qc.invalidateQueries({ queryKey: ["pakkesystem-keys"] });
    },
    onError: (e: any) => toast.error("Kunne ikke opprette nøkkel: " + (e?.message ?? "ukjent")),
  });

  const revokeKey = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pakkesystem_api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nøkkel tilbakekalt");
      qc.invalidateQueries({ queryKey: ["pakkesystem-keys"] });
    },
  });

  const deleteKey = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pakkesystem_api_keys").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nøkkel slettet");
      qc.invalidateQueries({ queryKey: ["pakkesystem-keys"] });
    },
    onError: (e: unknown) =>
      toast.error("Kunne ikke slette nøkkel: " + (e instanceof Error ? e.message : "ukjent feil")),
  });

  const createDest = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("pakkesystem_push_destinations").insert({
        legal_entity_id: NB_LEGAL_ENTITY_ID,
        name: destForm.name,
        url: destForm.url,
        push_time: destForm.push_time,
        target_offset_days: Number(destForm.target_offset_days),
        auth_header: destForm.auth_header || null,
        criteria: newDestCriteria as any,
        active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Destinasjon lagret");
      setDestOpen(false);
      setDestForm({ name: "", url: "", push_time: "04:00", target_offset_days: 0, auth_header: "" });
      setNewDestCriteria(DEFAULT_CRITERIA);
      qc.invalidateQueries({ queryKey: ["pakkesystem-dests"] });
    },
    onError: (e: any) => toast.error("Feilet: " + (e?.message ?? "ukjent")),
  });

  const updateDestCriteria = useMutation({
    mutationFn: async ({ id, criteria }: { id: string; criteria: ProduksjonsplanCriteria }) => {
      const { error } = await supabase
        .from("pakkesystem_push_destinations")
        .update({ criteria: criteria as any })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Kriterier oppdatert");
      qc.invalidateQueries({ queryKey: ["pakkesystem-dests"] });
    },
    onError: (e: any) => toast.error("Feilet: " + (e?.message ?? "ukjent")),
  });

  const toggleDest = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("pakkesystem_push_destinations").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pakkesystem-dests"] }),
  });

  const deleteDest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pakkesystem_push_destinations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pakkesystem-dests"] }),
  });

  const testPushNow = useMutation({
    mutationFn: async (destId: string) => {
      const dest = (dests.data ?? []).find((d) => d.id === destId);
      if (!dest) throw new Error("Fant ikke destinasjon");
      const { data: sess } = await supabase.auth.getSession();
      const jwt = sess.session?.access_token;
      if (!jwt) throw new Error("Ingen session");
      const destCrit = ((dest as any).criteria ?? DEFAULT_CRITERIA) as ProduksjonsplanCriteria;
      const exportRes = await fetch(`${FUNCTIONS_BASE}/pakkesystem-export?date=${downloadDate}&legal_entity_id=${NB_LEGAL_ENTITY_ID}${criteriaToQuery(destCrit)}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!exportRes.ok) throw new Error("Kunne ikke hente snapshot");
      const payload = await exportRes.text();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (dest.auth_header) headers["Authorization"] = dest.auth_header;
      const push = await fetch(dest.url, { method: dest.http_method ?? "POST", headers, body: payload });
      return push.status;
    },
    onSuccess: (status) => toast.success(`Test-push sendt (HTTP ${status})`),
    onError: (e: any) => toast.error("Test-push feilet: " + (e?.message ?? "ukjent")),
  });

  const downloadFile = async () => {
    const { data: sess } = await supabase.auth.getSession();
    const jwt = sess.session?.access_token;
    if (!jwt) return toast.error("Ingen session");
    const res = await fetch(`${FUNCTIONS_BASE}/pakkesystem-export?date=${downloadDate}&legal_entity_id=${NB_LEGAL_ENTITY_ID}${criteriaToQuery(downloadCriteria)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) {
      const err = await res.text();
      return toast.error("Nedlasting feilet: " + err.slice(0, 200));
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pakkefil-${downloadDate}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Pakkefil lastet ned");
  };

  const apiUrl = useMemo(() => `${FUNCTIONS_BASE}/pakkesystem-export?date=YYYY-MM-DD`, []);
  const schemaUrl = useMemo(() => `${FUNCTIONS_BASE}/pakkesystem-export?schema=1`, []);
  const declarationsUrl = useMemo(() => `${FUNCTIONS_BASE}/declarations-export`, []);
  const declarationsSchemaUrl = useMemo(() => `${FUNCTIONS_BASE}/declarations-export?schema=1`, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pakkesystem</h1>
        <p className="text-muted-foreground">Eksporter dagens ordre som JSON-snapshot — nedlasting, API eller planlagt push.</p>
      </div>

      {/* Manuell nedlastning */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Download className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Last ned pakkefil</h2>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <Label>Leveringsdato</Label>
            <Input type="date" value={downloadDate} onChange={(e) => setDownloadDate(e.target.value)} className="w-48" />
          </div>
          <NotesReadyBadge date={downloadDate} />
          <Button variant="outline" onClick={() => setDownloadCriteriaOpen(true)}>
            <SlidersHorizontal className="w-4 h-4 mr-2" /> Sett kriteria
          </Button>
          <Button onClick={downloadFile}>
            <Download className="w-4 h-4 mr-2" /> Last ned JSON
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Kriteria: <span className="font-medium">{criteriaSummary(downloadCriteria)}</span>. Samme filtrering som pakksedler/produksjonslister. Pakkefilen kan kun lastes ned etter at pakksedlene for leveringsdagen er generert.
        </p>
        <SettKriteriaDialog
          open={downloadCriteriaOpen}
          onOpenChange={setDownloadCriteriaOpen}
          legalEntityId={NB_LEGAL_ENTITY_ID}
          initial={downloadCriteria}
          onApply={(c) => setDownloadCriteria(c)}
        />


      </Card>

      {/* API-endepunkt */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ExternalLink className="w-5 h-5" />
          <h2 className="text-lg font-semibold">API-endepunkt</h2>
        </div>
        <div className="space-y-2 text-sm">
          <CopyRow label="Endepunkt (GET)" value={apiUrl} />
          <CopyRow label="JSON Schema" value={schemaUrl} />
          <p className="text-muted-foreground">
            Send <code className="bg-muted px-1 rounded">Authorization: Bearer nbps_...</code> header. Full snapshot, UTF-8, idempotent. Regenereres per request — hent så ofte du vil.
          </p>
        </div>
      </Card>

      {/* API-nøkler */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            <h2 className="text-lg font-semibold">API-nøkler</h2>
          </div>
          <Dialog open={newKeyOpen} onOpenChange={(o) => { setNewKeyOpen(o); if (!o) setRevealedKey(null); }}>
            <DialogTrigger asChild>
              <Button size="sm"><PlusCircle className="w-4 h-4 mr-2" /> Ny nøkkel</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{revealedKey ? "Kopier nøkkelen nå" : "Ny API-nøkkel"}</DialogTitle></DialogHeader>
              {!revealedKey ? (
                <div className="space-y-3">
                  <div>
                    <Label>Navn</Label>
                    <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Distrib 3.19" />
                  </div>
                  <div>
                    <Label>Notat (valgfritt)</Label>
                    <Textarea value={newKeyNote} onChange={(e) => setNewKeyNote(e.target.value)} rows={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Hva nøkkelen gir tilgang til</Label>
                    {(Object.keys(KEY_SCOPE_LABEL) as KeyScope[]).map((scope) => (
                      <label key={scope} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          checked={newKeyScopes[scope]}
                          onCheckedChange={(v) => setNewKeyScopes((s) => ({ ...s, [scope]: v === true }))}
                        />
                        <span>
                          {KEY_SCOPE_LABEL[scope]}
                          <span className="block text-xs text-muted-foreground">
                            {scope === "pakkesystem"
                              ? "Dagens ordre, kunder og varer for pakking."
                              : "Ingrediensliste, allergener og næringsinnhold for varer med godkjent merking."}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Nøkkelen vises kun én gang. Kopier og lagre den nå.</p>
                  <div className="flex gap-2">
                    <Input value={revealedKey} readOnly className="font-mono text-xs" />
                    <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(revealedKey); toast.success("Kopiert"); }}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
              <DialogFooter>
                {!revealedKey ? (
                  <Button
                    onClick={() => createKey.mutate()}
                    disabled={
                      !newKeyName ||
                      createKey.isPending ||
                      !(Object.keys(newKeyScopes) as KeyScope[]).some((s) => newKeyScopes[s])
                    }
                  >
                    Opprett
                  </Button>
                ) : (
                  <Button onClick={() => { setNewKeyOpen(false); setRevealedKey(null); }}>Ferdig</Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-2">
          {(keys.data ?? []).map((k) => (
            <div key={k.id} className="border rounded p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="font-medium">
                    {k.name}
                    {k.revoked_at && <Badge variant="destructive" className="ml-2">Tilbakekalt</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{k.key_prefix}…</div>
                  <div className="flex flex-wrap gap-1">
                    {((k.scopes ?? ["pakkesystem"]) as string[]).map((s) => (
                      <Badge key={s} variant="outline">
                        {KEY_SCOPE_LABEL[s as KeyScope] ?? s}
                      </Badge>
                    ))}
                  </div>
                  {k.note && <div className="text-xs text-muted-foreground">{k.note}</div>}
                  <div className="text-xs text-muted-foreground">
                    Opprettet {format(new Date(k.created_at), "yyyy-MM-dd HH:mm")}
                    {k.last_used_at && ` · sist brukt ${format(new Date(k.last_used_at), "yyyy-MM-dd HH:mm")}`}
                  </div>
                </div>
                {!k.revoked_at && (
                  <Button variant="ghost" size="sm" onClick={() => revokeKey.mutate(k.id)}>
                    <Trash2 className="w-4 h-4 mr-1" /> Tilbakekall
                  </Button>
                )}
              </div>
              {!k.revoked_at && (
                <KeyConnectionGuide
                  name={k.name}
                  keyPrefix={k.key_prefix}
                  scopes={((k.scopes ?? ["pakkesystem"]) as string[]).filter(
                    (s): s is KeyScope => s === "pakkesystem" || s === "declarations",
                  )}
                />
              )}
            </div>
          ))}
          {(keys.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Ingen nøkler opprettet enda.</p>
          )}
        </div>
      </Card>

      {/* Deklarasjoner */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ExternalLink className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Deklarasjoner og næringsinnhold</h2>
        </div>
        <div className="space-y-2 text-sm">
          <CopyRow label="Endepunkt (GET)" value={declarationsUrl} />
          <CopyRow label="JSON Schema" value={declarationsSchemaUrl} />
          <p className="text-muted-foreground">
            Krever en nøkkel med rettigheten «Deklarasjoner» i{" "}
            <code className="bg-muted px-1 rounded">Authorization: Bearer nbps_...</code>. Kun varer med godkjent merking
            følger med. Valgfrie parametere: <code className="bg-muted px-1 rounded">updated_since</code> (kun endringer
            etter et tidspunkt), <code className="bg-muted px-1 rounded">product_ids</code>,{" "}
            <code className="bg-muted px-1 rounded">page</code> og <code className="bg-muted px-1 rounded">page_size</code>{" "}
            (maks 500). Hver vare har <code className="bg-muted px-1 rounded">content_hash</code> så mottaker kan hoppe
            over uendrede varer.
          </p>
        </div>
      </Card>

      {/* Push-destinasjoner */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Planlagt push</h2>
          </div>
          <Dialog open={destOpen} onOpenChange={setDestOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><PlusCircle className="w-4 h-4 mr-2" /> Ny destinasjon</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Ny push-destinasjon</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Navn</Label>
                  <Input value={destForm.name} onChange={(e) => setDestForm({ ...destForm, name: e.target.value })} />
                </div>
                <div>
                  <Label>URL</Label>
                  <Input value={destForm.url} onChange={(e) => setDestForm({ ...destForm, url: e.target.value })} placeholder="https://distrib.no/api/nb/import" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Tidspunkt (Oslo)</Label>
                    <Input type="time" value={destForm.push_time} onChange={(e) => setDestForm({ ...destForm, push_time: e.target.value })} />
                  </div>
                  <div>
                    <Label>Dager frem</Label>
                    <Input type="number" value={destForm.target_offset_days} onChange={(e) => setDestForm({ ...destForm, target_offset_days: Number(e.target.value) })} />
                  </div>
                </div>
                <div>
                  <Label>Authorization-header (valgfritt)</Label>
                  <Input value={destForm.auth_header} onChange={(e) => setDestForm({ ...destForm, auth_header: e.target.value })} placeholder="Bearer xxx" />
                </div>
                <div className="border rounded p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="m-0">Kriteria (samme som pakksedler)</Label>
                    <Button size="sm" variant="outline" onClick={() => setNewDestCriteriaOpen(true)}>
                      <SlidersHorizontal className="w-4 h-4 mr-2" /> Endre
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{criteriaSummary(newDestCriteria)}</p>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => createDest.mutate()} disabled={!destForm.name || !destForm.url || createDest.isPending}>Lagre</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <SettKriteriaDialog
            open={newDestCriteriaOpen}
            onOpenChange={setNewDestCriteriaOpen}
            legalEntityId={NB_LEGAL_ENTITY_ID}
            initial={newDestCriteria}
            onApply={(c) => setNewDestCriteria(c)}
          />
        </div>


        <div className="space-y-2">
          {(dests.data ?? []).map((d) => (
            <div key={d.id} className="border rounded p-3 space-y-1">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {d.name}
                    {d.active ? <Badge variant="secondary">Aktiv</Badge> : <Badge variant="outline">Pauset</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{d.url}</div>
                  <div className="text-xs text-muted-foreground">
                    Kl. {String(d.push_time).slice(0, 5)} · +{d.target_offset_days} dager
                    {d.last_pushed_at && (
                      <> · sist {format(new Date(d.last_pushed_at), "yyyy-MM-dd HH:mm")}
                        {d.last_status_code === 0 || (d.last_status_code && d.last_status_code >= 400)
                          ? <XCircle className="inline w-3.5 h-3.5 text-destructive ml-1" />
                          : <CheckCircle2 className="inline w-3.5 h-3.5 text-primary ml-1" />}
                        {" "}({d.last_status_code})
                      </>
                    )}
                  </div>
                  {d.last_error && <div className="text-xs text-destructive">{d.last_error}</div>}
                  <div className="text-xs text-muted-foreground">
                    Kriteria: {criteriaSummary(((d as any).criteria ?? DEFAULT_CRITERIA) as ProduksjonsplanCriteria)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setDestCriteriaFor(d.id)}>
                    <SlidersHorizontal className="w-4 h-4 mr-1" /> Kriteria
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => testPushNow.mutate(d.id)} disabled={testPushNow.isPending}>
                    <Zap className="w-4 h-4 mr-1" /> Test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleDest.mutate({ id: d.id, active: !d.active })}>
                    {d.active ? "Pause" : "Aktiver"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteDest.mutate(d.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <SettKriteriaDialog
                open={destCriteriaFor === d.id}
                onOpenChange={(o) => { if (!o) setDestCriteriaFor(null); }}
                legalEntityId={NB_LEGAL_ENTITY_ID}
                initial={((d as any).criteria ?? DEFAULT_CRITERIA) as ProduksjonsplanCriteria}
                onApply={(c) => updateDestCriteria.mutate({ id: d.id, criteria: c })}
              />
            </div>
          ))}

          {(dests.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Ingen destinasjoner. Cron-jobb sjekker hvert 10. min.</p>
          )}
        </div>
      </Card>

      {/* Logg */}
      <Card className="p-6 space-y-3">
        <h2 className="text-lg font-semibold">Siste API-forespørsler</h2>
        <div className="space-y-1 text-xs font-mono">
          {(logs.data ?? []).map((l) => (
            <div key={l.id} className="flex justify-between border-b py-1">
              <span>{format(new Date(l.created_at), "yyyy-MM-dd HH:mm:ss")}</span>
              <span>{l.endpoint}</span>
              <span>{l.status_code} · {l.row_count} ordre</span>
              <span className="text-muted-foreground truncate max-w-[240px]">{l.ip}</span>
            </div>
          ))}
          {(logs.data ?? []).length === 0 && <p className="text-muted-foreground text-sm">Ingen loggede forespørsler enda.</p>}
        </div>
      </Card>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-32">{label}:</span>
      <code className="flex-1 bg-muted px-2 py-1 rounded text-xs font-mono truncate">{value}</code>
      <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(value); toast.success("Kopiert"); }}>
        <Copy className="w-4 h-4" />
      </Button>
    </div>
  );
}

/** Adressene mottakeren av en nøkkel trenger, avhengig av rettighetene. */
function endpointsForScopes(scopes: KeyScope[]): { label: string; url: string; note: string }[] {
  const out: { label: string; url: string; note: string }[] = [];
  if (scopes.includes("pakkesystem")) {
    out.push({
      label: "Pakkedata",
      url: `${FUNCTIONS_BASE}/pakkesystem-export?date=YYYY-MM-DD`,
      note: "Alle pakksedler for leveringsdagen. Bytt YYYY-MM-DD med datoen. Kan hentes så ofte dere vil.",
    });
    out.push({
      label: "Beskrivelse (JSON Schema)",
      url: `${FUNCTIONS_BASE}/pakkesystem-export?schema=1`,
      note: "Beskriver feltene i svaret. Krever ingen nøkkel.",
    });
  }
  if (scopes.includes("declarations")) {
    out.push({
      label: "Deklarasjoner",
      url: `${FUNCTIONS_BASE}/declarations-export`,
      note: "Ingrediensliste, allergener og næringsinnhold for varer med godkjent merking.",
    });
    out.push({
      label: "Beskrivelse (JSON Schema)",
      url: `${FUNCTIONS_BASE}/declarations-export?schema=1`,
      note: "Beskriver feltene i svaret. Krever ingen nøkkel.",
    });
  }
  return out;
}

function guideText(name: string, scopes: KeyScope[]): string {
  const lines = [
    `Oppkobling mot Nøtterø Bakeri (nøkkel: ${name})`,
    "",
    "1. Dere får en hemmelig nøkkel som starter med nbps_. Den sendes separat og skal lagres som en hemmelighet på serveren deres — aldri i nettleseren, i kildekoden eller i et delt dokument.",
    "2. Send nøkkelen med i hver forespørsel som HTTP-headeren:",
    "     Authorization: Bearer nbps_...",
    "3. Alle adressene under besvares med GET og svarer med JSON i UTF-8.",
    "",
    "Adresser:",
    ...endpointsForScopes(scopes).map((e) => `  ${e.label}: ${e.url}\n     ${e.note}`),
    "",
    "Eksempel:",
    `  curl -H "Authorization: Bearer nbps_..." "${endpointsForScopes(scopes)[0]?.url ?? ""}"`,
    "",
  ];
  if (scopes.includes("declarations")) {
    lines.push(
      "Om deklarasjoner:",
      "  - Kun varer som står som «Merking: Godkjent» følger med. Utdaterte eller ufullstendige varer utelates bevisst.",
      "  - Valgfrie parametere: updated_since=<ISO-tidspunkt> (kun endringer etter tidspunktet), product_ids=<id,id>, page og page_size (maks 500, standard 200).",
      "  - Svaret har has_more=true når det finnes flere sider — hent page=2, page=3 osv.",
      "  - Hver vare har content_hash. Lagre den, og hopp over varer der den er uendret.",
      "  - Felt per vare: navn, varenummer, strekkode, ingrediensliste (med *uthevede* allergener og som ren tekst), allergener, «kan inneholde spor av», næringsinnhold per 100 g, nettovekt, holdbarhet, oppbevaring, opprinnelsesland og tidspunkt for godkjenning.",
      "",
    );
  }
  lines.push(
    "Feilmeldinger:",
    "  401 = nøkkel mangler, er ukjent eller tilbakekalt.",
    "  403 = nøkkelen mangler riktig rettighet.",
    "  400 = ugyldig parameter (svaret sier hvilken).",
    "",
    "Nøkkelen kan når som helst trekkes tilbake av Nøtterø Bakeri. Da slutter henting å virke umiddelbart, og dere må få en ny nøkkel.",
  );
  return lines.join("\n");
}

/** Forklaring til den som skal koble seg opp med akkurat denne nøkkelen. */
function KeyConnectionGuide({ name, keyPrefix, scopes }: { name: string; keyPrefix: string; scopes: KeyScope[] }) {
  const [open, setOpen] = useState(false);
  const endpoints = useMemo(() => endpointsForScopes(scopes), [scopes]);
  const example = endpoints[0]?.url ?? "";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm">
          <ChevronDown className={`w-4 h-4 mr-2 transition-transform ${open ? "rotate-180" : ""}`} />
          Slik kobler mottaker seg opp
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-3 text-sm">
        <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
          <li>
            Send den hemmelige nøkkelen (<span className="font-mono">{keyPrefix}…</span>) til mottakeren på en trygg måte.
            Den vises kun én gang ved opprettelsen — er den mistet, lag en ny og trekk denne tilbake.
          </li>
          <li>
            Mottaker lagrer nøkkelen som en hemmelighet på sin egen server — aldri i nettleseren eller i kildekoden.
          </li>
          <li>
            Nøkkelen sendes med i hver forespørsel som headeren{" "}
            <code className="bg-muted px-1 rounded">Authorization: Bearer nbps_…</code>.
          </li>
          <li>Alle adressene under hentes med GET og svarer med JSON (UTF-8).</li>
        </ol>

        <div className="space-y-2">
          {endpoints.map((e) => (
            <div key={e.label + e.url} className="space-y-1">
              <CopyRow label={e.label} value={e.url} />
              <p className="text-xs text-muted-foreground pl-[8.5rem]">{e.note}</p>
            </div>
          ))}
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium">Eksempel på en forespørsel</p>
          <CopyRow label="curl" value={`curl -H "Authorization: Bearer nbps_..." "${example}"`} />
        </div>

        {scopes.includes("declarations") && (
          <div className="space-y-1">
            <p className="text-xs font-medium">Om deklarasjonene</p>
            <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
              <li>Kun varer med godkjent merking følger med — utdaterte eller ufullstendige varer utelates bevisst.</li>
              <li>
                Hent bare endringer med <code className="bg-muted px-1 rounded">updated_since</code> (ISO-tidspunkt), eller
                enkeltvarer med <code className="bg-muted px-1 rounded">product_ids</code>.
              </li>
              <li>
                Store uttrekk deles i sider: <code className="bg-muted px-1 rounded">page</code> og{" "}
                <code className="bg-muted px-1 rounded">page_size</code> (maks 500). Hent neste side så lenge{" "}
                <code className="bg-muted px-1 rounded">has_more</code> er sann.
              </li>
              <li>
                Hver vare har <code className="bg-muted px-1 rounded">content_hash</code> — lagre den og hopp over varer
                som er uendret.
              </li>
            </ul>
          </div>
        )}

        <div className="space-y-1">
          <p className="text-xs font-medium">Hvis noe feiler</p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
            <li>401 — nøkkelen mangler, er ukjent eller er trukket tilbake.</li>
            <li>403 — nøkkelen mangler riktig rettighet for denne adressen.</li>
            <li>400 — en parameter er ugyldig; svaret forteller hvilken.</li>
          </ul>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            navigator.clipboard.writeText(guideText(name, scopes));
            toast.success("Oppsettet er kopiert — lim det inn til mottakeren");
          }}
        >
          <Copy className="w-4 h-4 mr-2" /> Kopier hele oppsettet
        </Button>
        <p className="text-xs text-muted-foreground">
          Teksten inneholder ikke selve nøkkelen — send den separat.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
