import { useEffect, useRef, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import DOMPurify from "dompurify";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, ShieldCheck, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { useOrdreEmailSettings } from "@/ordre/hooks/useOrdreEmailSettings";
import { useEmailTemplates } from "@/ordre/hooks/useEmailTemplates";

export default function OrdreInnstillingerPage() {
  const { account, signature, loading, saving, saveSignature, startMicrosoftOAuth, completeMicrosoftOAuth, disconnectMicrosoft } = useOrdreEmailSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sigDraft, setSigDraft] = useState("");

  useEffect(() => {
    setSigDraft(signature);
  }, [signature]);

  // OAuth callback handling
  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (code && state) {
      const stored = sessionStorage.getItem("m365_oauth_state");
      if (stored && stored === state) {
        void completeMicrosoftOAuth(code, state).then(() => {
          sessionStorage.removeItem("m365_oauth_state");
          setSearchParams({});
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Innstillinger</h1>
        <p className="text-sm text-muted-foreground">E-post-konto, signatur og maler for Ordre-appen.</p>
      </div>

      {/* Kort 1: M365-konto */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Microsoft 365-konto
              </CardTitle>
              <CardDescription>Felles avsender-konto for utgående e-post.</CardDescription>
            </div>
            {account?.is_connected ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Tilkoblet
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <AlertCircle className="h-3 w-3" /> Ikke tilkoblet
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Laster …</p>
          ) : account?.is_connected ? (
            <>
              <div className="space-y-1 text-sm">
                <div><span className="text-muted-foreground">E-post:</span> <strong>{account.email_address}</strong></div>
                {account.display_name && <div><span className="text-muted-foreground">Navn:</span> {account.display_name}</div>}
                {account.connected_at && (
                  <div className="text-xs text-muted-foreground">
                    Koblet til {new Date(account.connected_at).toLocaleString("nb-NO")}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void startMicrosoftOAuth()}>Koble til ny konto</Button>
                <Button variant="destructive" onClick={() => void disconnectMicrosoft()}>Frakoble</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Ingen Microsoft-konto er koblet til. Klikk under for å autorisere via Microsoft 365.
              </p>
              <Button variant="brand" onClick={() => void startMicrosoftOAuth()}>
                <Mail className="mr-2 h-4 w-4" />
                Koble til Microsoft 365
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Kort 2: Signatur */}
      <Card>
        <CardHeader>
          <CardTitle>Felles signatur</CardTitle>
          <CardDescription>Brukes nederst i alle utgående e-poster (HTML støttet).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="signature">HTML-signatur</Label>
          <Textarea
            id="signature"
            value={sigDraft}
            onChange={(e) => setSigDraft(e.target.value)}
            rows={6}
            placeholder='<p>Med vennlig hilsen,<br/>Nøtterø Bakeri<br/><a href="https://nbhub.no">nbhub.no</a></p>'
            className="font-mono text-sm"
          />
          <div className="flex gap-2">
            <Button
              onClick={() => void saveSignature(sigDraft)}
              disabled={saving || sigDraft === signature}
            >
              Lagre signatur
            </Button>
            <Button variant="ghost" onClick={() => setSigDraft(signature)} disabled={sigDraft === signature}>
              Tilbakestill
            </Button>
          </div>
          {sigDraft && (
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground mb-2">Forhåndsvisning</div>
              <div className="text-sm" dangerouslySetInnerHTML={{ __html: sigDraft }} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kort 3: Mal-editor */}
      <TemplateEditorCard />
    </div>
  );
}

function TemplateEditorCard() {
  const { templates, loading, saving, saveTemplate } = useEmailTemplates();
  const [selectedId, setSelectedId] = useState<string>("");
  const [subjectDraft, setSubjectDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");

  useEffect(() => {
    if (!selectedId && templates.length) {
      setSelectedId(templates[0].id);
    }
  }, [templates, selectedId]);

  const selected = templates.find((t) => t.id === selectedId);

  useEffect(() => {
    if (selected) {
      setSubjectDraft(selected.subject_template);
      setBodyDraft(selected.body_html_template);
    }
  }, [selected]);

  const dirty = selected && (subjectDraft !== selected.subject_template || bodyDraft !== selected.body_html_template);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          E-post-maler
        </CardTitle>
        <CardDescription>Maler brukes i Bestillinger, Ticket og Avvik. Variabler i krøllparenteser fylles inn ved sending.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Laster maler …</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ingen maler er opprettet ennå.</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Velg mal</Label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selected && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="subject">Emne</Label>
                  <Input id="subject" value={subjectDraft} onChange={(e) => setSubjectDraft(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="body">HTML-innhold</Label>
                  <Textarea
                    id="body"
                    value={bodyDraft}
                    onChange={(e) => setBodyDraft(e.target.value)}
                    rows={12}
                    className="font-mono text-xs"
                  />
                </div>
                {selected.available_variables?.length > 0 && (
                  <div className="rounded-md border bg-muted/40 p-3">
                    <div className="text-xs font-medium mb-2">Tilgjengelige variabler</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.available_variables.map((v) => (
                        <Badge key={v.key} variant="outline" className="font-mono text-xs" title={v.description}>
                          {`{{${v.key}}}`}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={() => void saveTemplate(selected.id, {
                      subject_template: subjectDraft,
                      body_html_template: bodyDraft,
                    })}
                    disabled={saving || !dirty}
                  >
                    Lagre mal
                  </Button>
                  <Button variant="ghost" onClick={() => {
                    setSubjectDraft(selected.subject_template);
                    setBodyDraft(selected.body_html_template);
                  }} disabled={!dirty}>
                    Tilbakestill
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
