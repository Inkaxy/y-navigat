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
import { Mail, ShieldCheck, FileText, AlertCircle, CheckCircle2, Send } from "lucide-react";
import { useOrdreEmailSettings } from "@/ordre/hooks/useOrdreEmailSettings";
import { useEmailTemplates } from "@/ordre/hooks/useEmailTemplates";
import { SendTestEmailDialog } from "@/ordre/components/shell/SendTestEmailDialog";
import { EmailReceiveCard } from "@/ordre/components/shell/EmailReceiveCard";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { useToast } from "@/components/ui/use-toast";

export default function OrdreInnstillingerPage() {
  const { account, signature, loading, saving, saveSignature, startMicrosoftOAuth, disconnectMicrosoft, reload } = useOrdreEmailSettings();
  const { templates } = useEmailTemplates();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sigDraft, setSigDraft] = useState("");
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string>("");
  const { toast } = useToast();

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? ""));
  }, []);

  useEffect(() => {
    setSigDraft(signature);
  }, [signature]);

  // Les query-params satt av M365Callback
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected === "true") {
      toast({ title: "Koblet til Microsoft 365 ✓" });
      void reload();
      setSearchParams({}, { replace: true });
    } else if (error) {
      toast({ title: "Tilkobling feilet", description: error, variant: "destructive" });
      setSearchParams({}, { replace: true });
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

              <div className="border-t pt-4 mt-4 space-y-2">
                <div className="text-sm font-medium">Test e-post-utsending</div>
                <p className="text-xs text-muted-foreground">
                  Send en test-mail for å verifisere at hele kjeden (token, mal-rendering, signatur, sending) fungerer.
                </p>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-block">
                        <Button
                          variant="outline"
                          onClick={() => setTestDialogOpen(true)}
                          disabled={!account?.is_connected || templates.length === 0}
                        >
                          <Send className="mr-2 h-4 w-4" />
                          Send test-mail
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {(!account?.is_connected || templates.length === 0) && (
                      <TooltipContent>
                        {!account?.is_connected
                          ? "Microsoft 365 må være koblet til"
                          : "Ingen e-post-maler er opprettet"}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
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

      {/* Kort 3: E-post-mottak */}
      <EmailReceiveCard accountConnected={!!account?.is_connected} />

      {/* Kort 4: Mal-editor */}
      <TemplateEditorCard />

      <SendTestEmailDialog
        open={testDialogOpen}
        onOpenChange={setTestDialogOpen}
        defaultRecipient={userEmail}
      />
    </div>
  );
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}

function TemplateEditorCard() {
  const { templates, loading, saving, saveTemplate } = useEmailTemplates();
  const [selectedId, setSelectedId] = useState<string>("");
  const [subjectDraft, setSubjectDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastFocusedRef = useRef<"subject" | "body" | "text">("body");

  useEffect(() => {
    if (!selectedId && templates.length) setSelectedId(templates[0].id);
  }, [templates, selectedId]);

  const selected = templates.find((t) => t.id === selectedId);

  useEffect(() => {
    if (selected) {
      setSubjectDraft(selected.subject_template);
      setBodyDraft(selected.body_html_template);
      setTextDraft(selected.body_text_template ?? "");
    }
  }, [selected]);

  const dirty = !!selected && (
    subjectDraft !== selected.subject_template ||
    bodyDraft !== selected.body_html_template ||
    textDraft !== (selected.body_text_template ?? "")
  );

  const exampleVars = useMemo(() => {
    const out: Record<string, string> = {};
    selected?.available_variables?.forEach((v) => {
      out[v.key] = v.example ?? `{{${v.key}}}`;
    });
    return out;
  }, [selected]);

  const renderedSubject = useMemo(() => renderTemplate(subjectDraft, exampleVars), [subjectDraft, exampleVars]);
  const renderedHtml = useMemo(
    () => DOMPurify.sanitize(renderTemplate(bodyDraft, exampleVars), { USE_PROFILES: { html: true } }),
    [bodyDraft, exampleVars]
  );
  const renderedText = useMemo(() => renderTemplate(textDraft, exampleVars), [textDraft, exampleVars]);

  const insertVariable = (key: string) => {
    const token = `{{${key}}}`;
    const target = lastFocusedRef.current;
    if (target === "subject") {
      const el = subjectRef.current;
      if (!el) return;
      const start = el.selectionStart ?? subjectDraft.length;
      const end = el.selectionEnd ?? subjectDraft.length;
      const next = subjectDraft.slice(0, start) + token + subjectDraft.slice(end);
      setSubjectDraft(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    } else if (target === "text") {
      const el = textRef.current;
      const start = el?.selectionStart ?? textDraft.length;
      const end = el?.selectionEnd ?? textDraft.length;
      const next = textDraft.slice(0, start) + token + textDraft.slice(end);
      setTextDraft(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      const el = bodyRef.current;
      const start = el?.selectionStart ?? bodyDraft.length;
      const end = el?.selectionEnd ?? bodyDraft.length;
      const next = bodyDraft.slice(0, start) + token + bodyDraft.slice(end);
      setBodyDraft(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + token.length, start + token.length);
      });
    }
  };

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
              <Tabs defaultValue="edit" className="w-full">
                <TabsList>
                  <TabsTrigger value="edit">Rediger</TabsTrigger>
                  <TabsTrigger value="preview">Forhåndsvisning</TabsTrigger>
                </TabsList>

                <TabsContent value="edit" className="space-y-3 mt-3">
                  <div className="space-y-2">
                    <Label htmlFor="subject">Emne</Label>
                    <Input
                      id="subject"
                      ref={subjectRef}
                      value={subjectDraft}
                      onChange={(e) => setSubjectDraft(e.target.value)}
                      onFocus={() => (lastFocusedRef.current = "subject")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="body">HTML-innhold</Label>
                    <Textarea
                      id="body"
                      ref={bodyRef}
                      value={bodyDraft}
                      onChange={(e) => setBodyDraft(e.target.value)}
                      onFocus={() => (lastFocusedRef.current = "body")}
                      rows={12}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="text">Plain text-versjon (valgfri)</Label>
                    <Textarea
                      id="text"
                      ref={textRef}
                      value={textDraft}
                      onChange={(e) => setTextDraft(e.target.value)}
                      onFocus={() => (lastFocusedRef.current = "text")}
                      rows={6}
                      placeholder="Brukes som fallback for e-postklienter uten HTML-støtte og for tilgjengelighet"
                      className="font-mono text-xs"
                    />
                  </div>

                  {selected.available_variables?.length > 0 && (
                    <div className="rounded-md border bg-muted/40 p-3">
                      <div className="text-xs font-medium mb-2">Tilgjengelige variabler (klikk for å sette inn)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selected.available_variables.map((v) => (
                          <Badge
                            key={v.key}
                            variant="outline"
                            className="font-mono text-xs cursor-pointer hover:bg-accent"
                            title={v.description}
                            onClick={() => insertVariable(v.key)}
                          >
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
                        body_text_template: textDraft,
                      })}
                      disabled={saving || !dirty}
                    >
                      Lagre mal
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSubjectDraft(selected.subject_template);
                        setBodyDraft(selected.body_html_template);
                        setTextDraft(selected.body_text_template ?? "");
                      }}
                      disabled={!dirty}
                    >
                      Tilbakestill
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="preview" className="space-y-4 mt-3">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Emne (rendret)</div>
                    <div className="rounded-md border bg-background p-3 text-sm">{renderedSubject}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">HTML (rendret)</div>
                    <div
                      className="rounded-md border bg-background p-4 text-sm prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: renderedHtml }}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plain text (rendret)</div>
                    {renderedText.trim() ? (
                      <pre className="rounded-md border bg-muted/40 p-3 text-sm font-mono whitespace-pre-wrap">{renderedText}</pre>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">Ingen plain text-versjon definert.</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
