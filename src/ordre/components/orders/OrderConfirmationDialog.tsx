import { useEffect, useState } from "react";
import { Loader2, Mail, Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";

type Draft = {
  subject: string;
  body_html: string;
  body_text: string;
  language: "nb" | "en";
  intro_text: string;
  recipient_email_suggested: string | null;
  variables: Record<string, unknown>;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderId: string;
  ticketId?: string | null;
  defaultRecipient?: string | null;
  onSent?: () => void;
};

export function OrderConfirmationDialog({ open, onOpenChange, orderId, ticketId, defaultRecipient, onSent }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<Draft | null>(null);
  const [language, setLanguage] = useState<"nb" | "en" | "auto">("nb");
  const [aiIntro, setAiIntro] = useState(false);
  const [recipient, setRecipient] = useState(defaultRecipient ?? "");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyText, setBodyText] = useState("");

  const generate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-order-confirmation", {
        body: { order_id: orderId, language, ai_intro: aiIntro, ticket_id: ticketId ?? undefined },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Ukjent feil");
      const d = data as Draft & { ok: boolean };
      setDraft(d);
      setOriginal(d);
      setSubject(d.subject);
      setBodyHtml(d.body_html);
      setBodyText(d.body_text);
      if (!recipient && d.recipient_email_suggested) setRecipient(d.recipient_email_suggested);
    } catch (e: any) {
      toast({ title: "Kunne ikke generere", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !draft) generate();
    if (!open) {
      setDraft(null); setOriginal(null); setSubject(""); setBodyHtml(""); setBodyText("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const send = async () => {
    if (!recipient || !subject || !bodyHtml) {
      toast({ title: "Manglende felt", description: "Mottaker, emne og innhold må være fylt ut.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const edited = !!original && (subject !== original.subject || bodyHtml !== original.body_html || bodyText !== original.body_text);
      const { data, error } = await supabase.functions.invoke("send-order-confirmation", {
        body: {
          order_id: orderId,
          ticket_id: ticketId ?? undefined,
          recipient_email: recipient,
          subject, body_html: bodyHtml, body_text: bodyText,
          language: draft?.language ?? "nb",
          edited_by_user: edited,
          variables_snapshot: draft?.variables ?? null,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Bekreftelse sendt", description: `Til ${recipient}` });
      onSent?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Sending feilet", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Send ordrebekreftelse
            {draft && <Badge variant="secondary" className="ml-2">{draft.language === "en" ? "Engelsk" : "Norsk"}</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3 pb-2 border-b">
          <div className="space-y-1">
            <Label className="text-xs">Språk</Label>
            <Select value={language} onValueChange={(v) => setLanguage(v as any)}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nb">Norsk</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="auto">Auto</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="ai-intro" checked={aiIntro} onCheckedChange={setAiIntro} />
            <Label htmlFor="ai-intro" className="text-xs flex items-center gap-1 cursor-pointer">
              <Sparkles className="h-3 w-3" /> La AI skrive innledningen
            </Label>
          </div>
          <Button size="sm" variant="outline" onClick={generate} disabled={loading} className="ml-auto">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Regenerer utkast
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr,2fr] gap-3 overflow-hidden flex-1 min-h-0 pt-2">
          {/* Venstre: mottaker + emne + tekst-versjon */}
          <div className="space-y-3 overflow-y-auto pr-2">
            <div className="space-y-1">
              <Label className="text-xs">Til</Label>
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="kunde@eksempel.no" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Emne</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tekst-versjon (redigerbar)</Label>
              <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={14} className="font-mono text-xs" />
            </div>
          </div>

          {/* Høyre: preview + html-edit */}
          <div className="overflow-hidden flex flex-col min-h-0">
            <Tabs defaultValue="preview" className="flex-1 flex flex-col min-h-0">
              <TabsList className="self-start">
                <TabsTrigger value="preview">Forhåndsvisning</TabsTrigger>
                <TabsTrigger value="html">HTML (rediger)</TabsTrigger>
              </TabsList>
              <TabsContent value="preview" className="flex-1 overflow-y-auto border rounded-md p-3 bg-background mt-2">
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Genererer …</div>
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                )}
              </TabsContent>
              <TabsContent value="html" className="flex-1 overflow-hidden mt-2">
                <Textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} className="h-full min-h-[300px] font-mono text-xs" />
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <DialogFooter className="border-t pt-3">
          <p className="text-xs text-muted-foreground mr-auto">
            Strukturerte ordredata er hentet rett fra ordren. AI brukes kun til innledning/språk.
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Avbryt</Button>
          <Button onClick={send} disabled={sending || loading || !recipient || !subject || !bodyHtml}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
            Send bekreftelse
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
