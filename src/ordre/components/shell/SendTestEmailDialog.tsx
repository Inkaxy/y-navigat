import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEmailTemplates } from "@/ordre/hooks/useEmailTemplates";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRecipient?: string;
}

export function SendTestEmailDialog({ open, onOpenChange, defaultRecipient = "" }: Props) {
  const { templates, loading: loadingTemplates } = useEmailTemplates();
  const { toast } = useToast();
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [templateKey, setTemplateKey] = useState<string>("");
  const [varsJson, setVarsJson] = useState<string>("{}");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) setRecipient(defaultRecipient);
  }, [open, defaultRecipient]);

  // velg default mal
  useEffect(() => {
    if (!templateKey && templates.length) {
      const fav = templates.find((t) => t.template_key === "order_confirmation") ?? templates[0];
      setTemplateKey(fav.template_key);
    }
  }, [templates, templateKey]);

  const selected = useMemo(() => templates.find((t) => t.template_key === templateKey), [templates, templateKey]);

  // oppdater eksempel-vars når mal byttes
  useEffect(() => {
    if (!selected) return;
    const example: Record<string, string> = {};
    selected.available_variables?.forEach((v) => {
      example[v.key] = v.example ?? `{{${v.key}}}`;
    });
    setVarsJson(JSON.stringify(example, null, 2));
  }, [selected]);

  const handleSend = async () => {
    if (!recipient || !templateKey) {
      toast({ title: "Mottaker og mal er påkrevd", variant: "destructive" });
      return;
    }
    let parsedVars: Record<string, unknown> = {};
    try {
      parsedVars = JSON.parse(varsJson || "{}");
    } catch (e) {
      toast({ title: "Ugyldig JSON", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-test-email", {
        body: {
          template_key: templateKey,
          recipient_email: recipient,
          variables: parsedVars,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      if (data?.success) {
        toast({ title: "Test-mail sendt", description: `Sjekk innboksen til ${recipient}.` });
        onOpenChange(false);
      } else {
        toast({
          title: "Send feilet",
          description: data?.error ?? `Status: ${data?.status ?? "ukjent"}`,
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({ title: "Send feilet", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send test-mail</DialogTitle>
          <DialogDescription>
            Verifiser at hele kjeden (token, mal-rendering, signatur, sending) fungerer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recipient">Mottaker e-post</Label>
            <Input
              id="recipient"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="navn@eksempel.no"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template">Mal</Label>
            <Select value={templateKey} onValueChange={setTemplateKey} disabled={loadingTemplates}>
              <SelectTrigger id="template"><SelectValue placeholder="Velg mal" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.template_key}>{t.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vars">Variabler (JSON)</Label>
            <Textarea
              id="vars"
              value={varsJson}
              onChange={(e) => setVarsJson(e.target.value)}
              rows={8}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">Forhåndsutfylt med eksempelverdier fra valgt mal.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>Avbryt</Button>
          <Button onClick={handleSend} disabled={sending || !recipient || !templateKey}>
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
