import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Sparkles } from "lucide-react";
import { useEmailTemplates, type EmailTemplate } from "@/ordre/hooks/useEmailTemplates";

const VARIABLE_PRESETS: EmailTemplate["available_variables"] = [
  { key: "kunde_navn", description: "Kundens display_name", example: "Meny Eiktoppen" },
  { key: "ordrenr", description: "Ordrenummer", example: "2026-0042" },
  { key: "leveringsdato", description: "Levering DD.MM.YYYY", example: "08.05.2026" },
  { key: "leveringstid", description: "Tur-tidsvindu", example: "06:00-09:00" },
  { key: "linjer_html", description: "Tabell over ordrelinjer (HTML)", example: "<table>…</table>" },
  { key: "sum_inkl_mva", description: "Total inkl. MVA", example: "1 234,50 kr" },
  { key: "kunde_epost", description: "Kundens e-postadresse", example: "kunde@eksempel.no" },
];

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[æå]/g, "a")
    .replace(/ø/g, "o")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

export function NewEmailTemplateDialog({ open, onOpenChange, onCreated }: Props) {
  const { createTemplate, saving, templates } = useEmailTemplates();
  const [displayName, setDisplayName] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [keyManuallyEdited, setKeyManuallyEdited] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("<p>Hei {{kunde_navn}},</p>\n<p></p>\n<p>Med vennlig hilsen,<br/>Nøtterø Bakeri</p>");
  const [selectedVars, setSelectedVars] = useState<string[]>(["kunde_navn", "ordrenr"]);

  const effectiveKey = keyManuallyEdited ? templateKey : slugify(displayName);
  const keyConflict = useMemo(
    () => effectiveKey.length > 0 && templates.some((t) => t.template_key === effectiveKey),
    [effectiveKey, templates]
  );

  const reset = () => {
    setDisplayName("");
    setTemplateKey("");
    setKeyManuallyEdited(false);
    setSubject("");
    setBody("<p>Hei {{kunde_navn}},</p>\n<p></p>\n<p>Med vennlig hilsen,<br/>Nøtterø Bakeri</p>");
    setSelectedVars(["kunde_navn", "ordrenr"]);
  };

  const canSubmit = displayName.trim() && effectiveKey && subject.trim() && body.trim() && !keyConflict;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const vars = VARIABLE_PRESETS.filter((v) => selectedVars.includes(v.key));
    const created = await createTemplate({
      template_key: effectiveKey,
      display_name: displayName.trim(),
      subject_template: subject.trim(),
      body_html_template: body,
      available_variables: vars,
    });
    if (created) {
      onCreated?.(created.id);
      reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Ny e-post-mal
          </DialogTitle>
          <DialogDescription>
            Gi malen et navn og velg hvilke variabler den skal støtte. Du kan finjustere innholdet etterpå.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name" className="text-xs">Visningsnavn</Label>
              <Input
                id="tpl-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="F.eks. Tilbud sendt"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-key" className="text-xs">
                Teknisk nøkkel
                <span className="ml-1 font-normal text-muted-foreground">(brukes i kode)</span>
              </Label>
              <Input
                id="tpl-key"
                value={effectiveKey}
                onChange={(e) => { setKeyManuallyEdited(true); setTemplateKey(slugify(e.target.value)); }}
                placeholder="auto fra navn"
                className="font-mono text-xs"
              />
              {keyConflict && (
                <p className="text-[11px] text-destructive">En mal med denne nøkkelen finnes allerede.</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-subject" className="text-xs">Emne</Label>
            <Input
              id="tpl-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="F.eks. Tilbud — ordre {{ordrenr}}"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-body" className="text-xs">HTML-innhold (start)</Label>
            <Textarea
              id="tpl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Tilgjengelige variabler</Label>
            <p className="text-[11px] text-muted-foreground">
              Velg hvilke variabler malen skal kunne sette inn. Du kan endre dette senere.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {VARIABLE_PRESETS.map((v) => {
                const checked = selectedVars.includes(v.key);
                return (
                  <label
                    key={v.key}
                    className="flex cursor-pointer items-start gap-2 rounded-md border bg-muted/30 p-2 hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) => {
                        setSelectedVars((prev) =>
                          c ? [...prev, v.key] : prev.filter((k) => k !== v.key)
                        );
                      }}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] font-medium text-primary">{`{{${v.key}}}`}</div>
                      <div className="text-[10px] leading-snug text-muted-foreground">{v.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Avbryt</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Opprett mal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
