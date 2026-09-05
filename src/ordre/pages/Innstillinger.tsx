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
import { Mail, ShieldCheck, FileText, AlertCircle, CheckCircle2, Send, Eye, Code2, Type, RotateCcw, Save, Plus, Search, Loader2, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { NewEmailTemplateDialog } from "@/ordre/components/shell/NewEmailTemplateDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useOrdreEmailSettings } from "@/ordre/hooks/useOrdreEmailSettings";
import { useEmailTemplates } from "@/ordre/hooks/useEmailTemplates";
import { SendTestEmailDialog } from "@/ordre/components/shell/SendTestEmailDialog";
import { EmailReceiveCard } from "@/ordre/components/shell/EmailReceiveCard";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RichTextEditor, type RichTextEditorHandle } from "@/ordre/components/shell/RichTextEditor";
import { AiSettingsCard } from "@/ordre/components/shell/AiSettingsCard";
import { SlaSettingsCard } from "@/ordre/components/shell/SlaSettingsCard";
import { OrdreDeskSettingsCard } from "@/ordre/components/shell/OrdreDeskSettingsCard";
import { CakeImagesSettingsCard } from "@/ordre/components/shell/CakeImagesSettingsCard";

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
          <Label>Signatur</Label>
          <RichTextEditor
            value={sigDraft}
            onChange={setSigDraft}
            placeholder="Med vennlig hilsen, Nøtterø Bakeri…"
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
              <div
                className="prose prose-sm max-w-none text-sm"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(sigDraft, { USE_PROFILES: { html: true } }) }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kort 3: E-post-mottak */}
      <EmailReceiveCard accountConnected={!!account?.is_connected} />

      {/* Kort 4: AI-analyse */}
      <AiSettingsCard />

      {/* Kort 4b: SLA-frister */}
      <SlaSettingsCard />

      {/* Ordrekontor — grenser og standardtekster */}
      <OrdreDeskSettingsCard />


      {/* Kort 5: Kakebilder */}
      <CakeImagesSettingsCard />

      {/* Kort 6: Mal-editor */}
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
  const { templates, loading, saving, saveTemplate, deleteTemplate } = useEmailTemplates();
  const [selectedId, setSelectedId] = useState<string>("");
  const [subjectDraft, setSubjectDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bodyEditorRef = useRef<RichTextEditorHandle>(null);
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
      bodyEditorRef.current?.insertText(token);
    }
  };

  const [filter, setFilter] = useState("");
  const filteredTemplates = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return templates;
    return templates.filter((t) =>
      t.display_name.toLowerCase().includes(f),
    );
  }, [templates, filter]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              E-post-maler
            </CardTitle>
            <CardDescription className="mt-1">
              Velg en mal til venstre, rediger emne og innhold til høyre. Variabler i krøllparenteser
              (f.eks. <code className="rounded bg-muted px-1 py-0.5 text-xs">{`{{kunde_navn}}`}</code>)
              fylles inn automatisk når mailen sendes.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setNewDialogOpen(true)} className="shrink-0">
            <Plus className="mr-1.5 h-4 w-4" /> Ny mal
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Laster maler …
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/30 py-10 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Ingen e-post-maler ennå</p>
              <p className="text-xs text-muted-foreground">
                Klikk «Ny mal» for å opprette din første mal.
              </p>
            </div>
            <Button size="sm" onClick={() => setNewDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Opprett mal
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            {/* Venstre: liste over maler */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Søk maler…"
                  className="h-8 pl-7 text-xs"
                />
              </div>
              <ScrollArea className="h-[460px] rounded-md border">
                <div className="space-y-0.5 p-1">
                  {filteredTemplates.map((t) => {
                    const isActive = t.id === selectedId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedId(t.id)}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                          isActive
                            ? "bg-accent text-accent-foreground ring-1 ring-primary/30"
                            : "hover:bg-muted/60",
                        )}
                      >
                        <span className="font-medium leading-tight">{t.display_name}</span>
                      </button>
                    );
                  })}
                  {filteredTemplates.length === 0 && (
                    <p className="px-2.5 py-3 text-xs text-muted-foreground">
                      Ingen maler matcher «{filter}».
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Høyre: editor + preview */}
            {selected ? (
              <div className="min-w-0 space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold">{selected.display_name}</h3>
                  </div>
                  {dirty && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-warning">
                      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                      Ulagrede endringer
                    </span>
                  )}
                </div>

                <Tabs defaultValue="edit" className="w-full">
                  <TabsList className="grid w-full max-w-sm grid-cols-2">
                    <TabsTrigger value="edit" className="gap-1.5">
                      <Code2 className="h-3.5 w-3.5" /> Rediger
                    </TabsTrigger>
                    <TabsTrigger value="preview" className="gap-1.5">
                      <Eye className="h-3.5 w-3.5" /> Forhåndsvisning
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="edit" className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="subject" className="text-xs font-medium">
                        Emne
                      </Label>
                      <Input
                        id="subject"
                        ref={subjectRef}
                        value={subjectDraft}
                        onChange={(e) => setSubjectDraft(e.target.value)}
                        onFocus={() => (lastFocusedRef.current = "subject")}
                        placeholder="F.eks. Bekreftelse på din ordre {{ordre_nr}}"
                      />
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-medium">Innhold</Label>
                          <span className="text-[10px] text-muted-foreground">
                            Bruk verktøylinjen — som i Word.
                          </span>
                        </div>
                        <RichTextEditor
                          ref={bodyEditorRef}
                          value={bodyDraft}
                          onChange={setBodyDraft}
                          onFocus={() => (lastFocusedRef.current = "body")}
                          placeholder="Skriv e-postinnholdet her…"
                        />
                      </div>

                      {/* Variabel-panel */}
                      {selected.available_variables?.length > 0 && (
                        <div className="relative space-y-2 overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.04] via-background to-background p-3 shadow-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs font-semibold tracking-tight">
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-primary/15 text-primary">
                                <Plus className="h-3 w-3" />
                              </span>
                              Variabler
                            </div>
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {selected.available_variables.length}
                            </span>
                          </div>
                          <p className="text-[11px] leading-snug text-muted-foreground">
                            Klikk for å sette inn der markøren står.
                          </p>
                          <ScrollArea className="-mx-1 h-[300px] px-1">
                            <div className="space-y-1">
                              {selected.available_variables.map((v) => (
                                <TooltipProvider key={v.key} delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => insertVariable(v.key)}
                                        className="group flex w-full items-center gap-2 rounded-lg border border-transparent bg-background/70 px-2.5 py-2 text-left transition-all hover:-translate-y-px hover:border-primary/40 hover:bg-background hover:shadow-sm active:translate-y-0"
                                      >
                                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
                                          <Plus className="h-3.5 w-3.5" />
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-xs font-medium leading-tight">
                                          {v.description || v.key}
                                        </span>
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="font-mono text-[11px]">
                                      {`{{${v.key}}}`}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ))}
                            </div>
                          </ScrollArea>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="text" className="flex items-center gap-1.5 text-xs font-medium">
                        <Type className="h-3.5 w-3.5" />
                        Plain text-versjon
                        <span className="font-normal text-muted-foreground">(valgfri)</span>
                      </Label>
                      <Textarea
                        id="text"
                        ref={textRef}
                        value={textDraft}
                        onChange={(e) => setTextDraft(e.target.value)}
                        onFocus={() => (lastFocusedRef.current = "text")}
                        rows={5}
                        placeholder="Brukes som fallback for e-postklienter uten HTML-støtte og forbedrer tilgjengelighet."
                        className="font-mono text-xs leading-relaxed"
                      />
                    </div>

                    {/* Sticky lagre-bar */}
                    <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-2 border-t bg-card/95 px-6 py-3 backdrop-blur">
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {dirty ? "Du har ulagrede endringer." : "Alt er lagret."}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDelete(true)}
                          disabled={saving}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Slett
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSubjectDraft(selected.subject_template);
                            setBodyDraft(selected.body_html_template);
                            setTextDraft(selected.body_text_template ?? "");
                          }}
                          disabled={!dirty}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Tilbakestill
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            void saveTemplate(selected.id, {
                              subject_template: subjectDraft,
                              body_html_template: bodyDraft,
                              body_text_template: textDraft,
                            })
                          }
                          disabled={saving || !dirty}
                        >
                          {saving ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Lagre mal
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="preview" className="mt-3 space-y-3">
                    {/* Mail-aktig forhåndsvisning */}
                    <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
                      <div className="space-y-1 border-b bg-muted/40 px-4 py-3">
                        <div className="flex items-baseline gap-2 text-xs">
                          <span className="w-12 shrink-0 text-muted-foreground">Fra:</span>
                          <span className="font-medium">Nøtterø Bakeri &lt;noreply@nbhub.no&gt;</span>
                        </div>
                        <div className="flex items-baseline gap-2 text-xs">
                          <span className="w-12 shrink-0 text-muted-foreground">Til:</span>
                          <span className="font-medium">{exampleVars["kunde_epost"] ?? "kunde@eksempel.no"}</span>
                        </div>
                        <div className="flex items-baseline gap-2 pt-1 text-sm">
                          <span className="w-12 shrink-0 text-xs text-muted-foreground">Emne:</span>
                          <span className="font-semibold">{renderedSubject || <span className="italic text-muted-foreground">(tomt emne)</span>}</span>
                        </div>
                      </div>
                      <div
                        className="prose prose-sm max-w-none p-5 text-sm"
                        dangerouslySetInnerHTML={{ __html: renderedHtml }}
                      />
                    </div>

                    <details className="rounded-md border bg-muted/30">
                      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                        Vis plain text-versjon
                      </summary>
                      <div className="border-t p-3">
                        {renderedText.trim() ? (
                          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{renderedText}</pre>
                        ) : (
                          <p className="text-xs italic text-muted-foreground">Ingen plain text-versjon definert.</p>
                        )}
                      </div>
                    </details>
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-md border border-dashed bg-muted/30 p-10 text-sm text-muted-foreground">
                Velg en mal til venstre for å redigere.
              </div>
            )}
          </div>
        )}
      </CardContent>

      <NewEmailTemplateDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={(id) => setSelectedId(id)}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slett mal?</AlertDialogTitle>
            <AlertDialogDescription>
              Dette sletter malen «{selected?.display_name}» permanent. Eventuell kode som refererer til
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">{selected?.template_key}</code>
              vil slutte å fungere.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!selected) return;
                const ok = await deleteTemplate(selected.id);
                if (ok) setSelectedId("");
                setConfirmDelete(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Slett mal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
