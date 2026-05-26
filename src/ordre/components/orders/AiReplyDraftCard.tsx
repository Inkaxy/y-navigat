import { useState } from "react";
import { Loader2, Sparkles, MessageSquareQuote, HelpCircle, Edit3, Ban, ThumbsDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

export type ReplyType = "clarify" | "reply" | "change" | "cancellation" | "polite_decline";
export type Tone = "kort" | "vennlig" | "profesjonell" | "tydelig";
type Language = "auto" | "nb" | "en";

type Props = {
  ticketId: string;
  hasOrder: boolean;
  requestType?: string | null;
  /** Receives the generated draft text — caller fills its reply textarea. */
  onDraft: (text: string) => void;
};

const BUTTONS: { type: ReplyType; label: string; icon: React.ReactNode; show: (hasOrder: boolean) => boolean }[] = [
  { type: "clarify",        label: "Avklaringsmail",          icon: <HelpCircle className="h-3.5 w-3.5" />,        show: () => true },
  { type: "reply",          label: "Svar til kunde",          icon: <MessageSquareQuote className="h-3.5 w-3.5" />, show: () => true },
  { type: "change",         label: "Svar om endring",         icon: <Edit3 className="h-3.5 w-3.5" />,             show: (h) => h },
  { type: "cancellation",   label: "Svar om kansellering",    icon: <Ban className="h-3.5 w-3.5" />,               show: (h) => h },
  { type: "polite_decline", label: "Høflig avslag / alt.",    icon: <ThumbsDown className="h-3.5 w-3.5" />,        show: () => true },
];

export function AiReplyDraftCard({ ticketId, hasOrder, requestType, onDraft }: Props) {
  const { toast } = useToast();
  const [tone, setTone] = useState<Tone[]>(["vennlig", "profesjonell", "tydelig"]);
  const [language, setLanguage] = useState<Language>("auto");
  const [loadingType, setLoadingType] = useState<ReplyType | null>(null);
  const [lastDetected, setLastDetected] = useState<"nb" | "en" | null>(null);

  const generate = async (type: ReplyType) => {
    setLoadingType(type);
    try {
      const { data, error } = await supabase.functions.invoke("generate-ticket-reply", {
        body: {
          ticket_id: ticketId,
          reply_type: type,
          tone: tone.length ? tone : ["vennlig", "profesjonell"],
          language,
        },
      });
      if (error) throw error;
      if (!data?.draft?.body_text) throw new Error("AI returnerte ingen tekst");
      onDraft(data.draft.body_text);
      setLastDetected(data.detected_language ?? null);
      toast({
        title: "Utkast generert",
        description: `Språk: ${data.detected_language === "en" ? "Engelsk" : "Norsk"}. Husk å lese gjennom før du sender.`,
      });
    } catch (e: any) {
      toast({
        title: "Kunne ikke generere svar",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setLoadingType(null);
    }
  };

  const suggested: ReplyType | null =
    requestType === "change" ? "change" :
    requestType === "cancellation" ? "cancellation" :
    requestType === "question" ? "reply" :
    requestType === "complaint" ? "reply" :
    null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          AI svar-utkast
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Genererer et redigerbart utkast i svar-feltet. Ingenting sendes automatisk.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Tone */}
        <div className="space-y-1">
          <Label className="text-xs">Tone</Label>
          <ToggleGroup
            type="multiple"
            value={tone}
            onValueChange={(v) => setTone(v as Tone[])}
            className="flex flex-wrap justify-start gap-1"
            size="sm"
          >
            <ToggleGroupItem value="kort" className="h-7 px-2 text-xs">Kort</ToggleGroupItem>
            <ToggleGroupItem value="vennlig" className="h-7 px-2 text-xs">Vennlig</ToggleGroupItem>
            <ToggleGroupItem value="profesjonell" className="h-7 px-2 text-xs">Profesjonell</ToggleGroupItem>
            <ToggleGroupItem value="tydelig" className="h-7 px-2 text-xs">Tydelig</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Språk */}
        <div className="space-y-1">
          <Label className="text-xs">Språk</Label>
          <div className="flex items-center gap-2">
            <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
              <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (detekter)</SelectItem>
                <SelectItem value="nb">Norsk</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
            {lastDetected && language === "auto" && (
              <Badge variant="secondary" className="text-[10px]">
                Sist detektert: {lastDetected === "en" ? "Engelsk" : "Norsk"}
              </Badge>
            )}
          </div>
        </div>

        {/* Knapper */}
        <div className="space-y-1 pt-1">
          <Label className="text-xs">Generer</Label>
          <div className="flex flex-wrap gap-1.5">
            {BUTTONS.filter((b) => b.show(hasOrder)).map((b) => {
              const isLoading = loadingType === b.type;
              const isSuggested = suggested === b.type;
              return (
                <Button
                  key={b.type}
                  size="sm"
                  variant={isSuggested ? "default" : "outline"}
                  className="h-8 gap-1.5 text-xs"
                  disabled={loadingType !== null}
                  onClick={() => generate(b.type)}
                >
                  {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : b.icon}
                  {b.label}
                </Button>
              );
            })}
          </div>
          {suggested && (
            <p className="text-[11px] text-muted-foreground pt-1">
              Foreslått ut fra AI-klassifisering: <strong>{BUTTONS.find((b) => b.type === suggested)?.label}</strong>
            </p>
          )}
          {!hasOrder && (
            <p className="text-[11px] text-muted-foreground pt-1">
              Koble ticketen til en ordre for å aktivere endring/kansellering-svar.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
