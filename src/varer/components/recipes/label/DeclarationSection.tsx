import DOMPurify from "dompurify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";

interface Props {
  declarationHtml: string | null;
  allergens: { contains?: string[]; may_contain?: string[] } | null;
  /** Linjer uten råvarekobling — de teller ikke i beregningen. */
  unlinkedCount: number;
  unclassifiedNames: string[];
}

/** Ingredienslisten slik den vil stå på pakken. */
export function DeclarationSection({ declarationHtml, allergens, unlinkedCount, unclassifiedNames }: Props) {
  const html = declarationHtml ?? "";
  const plain = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">Deklarasjon</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={!plain}
          onClick={() => {
            navigator.clipboard.writeText(plain);
            toast.success("Ingredienslisten er kopiert");
          }}
        >
          <Copy className="mr-1.5 h-4 w-4" /> Kopier tekst
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[2fr,1fr]">
        <div className="space-y-2">
          {plain ? (
            <div
              className="rounded-md border bg-muted/30 p-3 text-sm leading-relaxed [&_b]:font-semibold [&_strong]:font-semibold"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Ingen ingrediensliste beregnet ennå.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Allergener er uthevet, og QUID-prosenter står i parentes der de kreves.
          </p>

          {unlinkedCount > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                {unlinkedCount} ingrediens{unlinkedCount === 1 ? "" : "er"} er fritekst uten råvarekobling. De kommer
                <b> ikke</b> med i næring, allergener eller grovhet — koble dem til en råvare i oppskriften.
              </span>
            </div>
          )}
          {unclassifiedNames.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>Uten kornklassifisering: {unclassifiedNames.join(", ")} — grovheten kan være feil.</span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inneholder</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(allergens?.contains ?? []).length ? (
                allergens!.contains!.map((a) => <Badge key={a} variant="secondary">{a}</Badge>)
              ) : (
                <span className="text-sm text-muted-foreground">Ingen registrert</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Kan inneholde spor av
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(allergens?.may_contain ?? []).length ? (
                allergens!.may_contain!.map((a) => <Badge key={a} variant="outline">{a}</Badge>)
              ) : (
                <span className="text-sm text-muted-foreground">Ingen registrert</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
