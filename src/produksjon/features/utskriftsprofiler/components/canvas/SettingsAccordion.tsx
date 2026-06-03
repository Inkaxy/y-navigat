import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Trash2, Upload } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

interface Props {
  // Margins
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  setMarginTop: (v: number) => void;
  setMarginRight: (v: number) => void;
  setMarginBottom: (v: number) => void;
  setMarginLeft: (v: number) => void;

  // Custom paper toggle
  paperWidth: number;
  paperHeight: number;
  setPaperWidth: (v: number) => void;
  setPaperHeight: (v: number) => void;

  // Company
  companyName: string;
  setCompanyName: (v: string) => void;
  companyNote: string;
  setCompanyNote: (v: string) => void;

  // Logo
  logoUrl: string | null;
  setLogoUrl: (v: string | null) => void;
  logoHeight: number | "";
  setLogoHeight: (v: number | "") => void;
  logoUploading: boolean;
  onLogoFileSelected: (file: File) => void;

  // Comment includes
  commentFt1: boolean;
  commentFt2: boolean;
  commentFt3: boolean;
  setCommentFt1: (v: boolean) => void;
  setCommentFt2: (v: boolean) => void;
  setCommentFt3: (v: boolean) => void;

  // Globals
  includeFieldLabels: boolean;
  setIncludeFieldLabels: (v: boolean) => void;
  fieldLabelsBold: boolean;
  setFieldLabelsBold: (v: boolean) => void;
  skipLeveresHentes: boolean;
  setSkipLeveresHentes: (v: boolean) => void;
  includeRouteName: boolean;
  setIncludeRouteName: (v: boolean) => void;

  // Notes
  notes: string;
  setNotes: (v: string) => void;
}

export function SettingsAccordion(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Accordion
      type="multiple"
      defaultValue={["paper", "company"]}
      className="w-full"
    >
      <AccordionItem value="paper">
        <AccordionTrigger className="text-sm font-medium">
          Papirstørrelse og marger
        </AccordionTrigger>
        <AccordionContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumField
              label="Bredde (mm)"
              value={p.paperWidth}
              onChange={p.setPaperWidth}
            />
            <NumField
              label="Høyde (mm)"
              value={p.paperHeight}
              onChange={p.setPaperHeight}
            />
          </div>
          <Separator />
          <p className="text-xs font-medium text-muted-foreground">Marger (mm)</p>
          <div className="grid grid-cols-2 gap-3">
            <MarginStepper label="Topp" value={p.marginTop} onChange={p.setMarginTop} />
            <MarginStepper label="Bunn" value={p.marginBottom} onChange={p.setMarginBottom} />
            <MarginStepper label="Venstre" value={p.marginLeft} onChange={p.setMarginLeft} />
            <MarginStepper label="Høyre" value={p.marginRight} onChange={p.setMarginRight} />
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="company">
        <AccordionTrigger className="text-sm font-medium">Firma</AccordionTrigger>
        <AccordionContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sa-cn">Firmanavn</Label>
            <Input
              id="sa-cn"
              value={p.companyName}
              onChange={(e) => p.setCompanyName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sa-cnote">Firmamerknad</Label>
            <Input
              id="sa-cnote"
              value={p.companyNote}
              onChange={(e) => p.setCompanyNote(e.target.value)}
              maxLength={150}
            />
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="logo">
        <AccordionTrigger className="text-sm font-medium">Logo</AccordionTrigger>
        <AccordionContent className="space-y-3">
          {p.logoUrl ? (
            <div className="flex items-center gap-3">
              <img
                src={p.logoUrl}
                alt="Logo"
                className="h-14 w-auto rounded border border-border bg-card object-contain p-1"
              />
              <div className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={p.logoUploading}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Bytt
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => p.setLogoUrl(null)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Fjern
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={p.logoUploading}
              className="w-full"
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              {p.logoUploading ? "Laster opp …" : "Last opp logo"}
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                p.onLogoFileSelected(f);
                e.target.value = "";
              }
            }}
          />
          <NumField
            label="Logo høyde (mm)"
            value={typeof p.logoHeight === "number" ? p.logoHeight : 0}
            onChange={p.setLogoHeight}
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="comment">
        <AccordionTrigger className="text-sm font-medium">
          Kommentar inneholder
        </AccordionTrigger>
        <AccordionContent className="space-y-2">
          <CheckRow id="ft1" label="Fritekst 1" value={p.commentFt1} onChange={p.setCommentFt1} />
          <CheckRow id="ft2" label="Fritekst 2" value={p.commentFt2} onChange={p.setCommentFt2} />
          <CheckRow id="ft3" label="Fritekst 3" value={p.commentFt3} onChange={p.setCommentFt3} />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="globals">
        <AccordionTrigger className="text-sm font-medium">Generelt</AccordionTrigger>
        <AccordionContent className="space-y-2">
          <CheckRow
            id="incl-labels"
            label="Ta med feltnavn"
            value={p.includeFieldLabels}
            onChange={p.setIncludeFieldLabels}
          />
          <CheckRow
            id="labels-bold"
            label="Feltnavn uthevet"
            value={p.fieldLabelsBold}
            onChange={p.setFieldLabelsBold}
          />
          <CheckRow
            id="skip-lh"
            label='Skjul "leveres" / "hentes" hvis ikke satt'
            value={p.skipLeveresHentes}
            onChange={p.setSkipLeveresHentes}
          />
          <CheckRow
            id="incl-route"
            label="Ta med kjørerutenavn"
            value={p.includeRouteName}
            onChange={p.setIncludeRouteName}
          />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="notes">
        <AccordionTrigger className="text-sm font-medium">Notater</AccordionTrigger>
        <AccordionContent>
          <Textarea
            value={p.notes}
            onChange={(e) => p.setNotes(e.target.value)}
            placeholder="Valgfri notat — kun synlig i innstillinger."
            rows={3}
            maxLength={500}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-8"
      />
    </div>
  );
}

function CheckRow({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={value}
        onCheckedChange={(v) => onChange(!!v)}
        className="mt-0.5"
      />
      <Label htmlFor={id} className="text-sm font-normal leading-tight">
        {label}
      </Label>
    </div>
  );
}
