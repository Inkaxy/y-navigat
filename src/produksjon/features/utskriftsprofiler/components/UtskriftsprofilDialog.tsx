import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import {
  defaultFieldSize,
  defaultFields,
  type FieldType,
  type LabelPrintProfile,
  type ProfileField,
} from "../types";
import {
  DuplicateProfileNameError,
  useCreateLabelPrintProfile,
  useUpdateLabelPrintProfile,
} from "../hooks/useLabelPrintProfileMutations";
import type { LegalEntityOption } from "@/features/produksjonsavdelinger/hooks/useLegalEntities";
import { FieldPalette } from "./canvas/FieldPalette";
import { LabelCanvas } from "./canvas/LabelCanvas";
import { InlineToolbar } from "./canvas/InlineToolbar";
import { PaperPresetSelect } from "./canvas/PaperPresetSelect";
import { SettingsAccordion } from "./canvas/SettingsAccordion";
import { getInnerArea, migrateLegacyFields, round1, clamp } from "../lib/canvasUtils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  legalEntity: LegalEntityOption | null;
  existing?: LabelPrintProfile | null;
}

const LOGO_BUCKET = "label-logos";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function UtskriftsprofilDialog({
  open,
  onOpenChange,
  mode,
  legalEntity,
  existing,
}: Props) {
  const [name, setName] = useState("");
  const [paperWidth, setPaperWidth] = useState(100);
  const [paperHeight, setPaperHeight] = useState(75);
  const [marginTop, setMarginTop] = useState(0);
  const [marginBottom, setMarginBottom] = useState(0);
  const [marginLeft, setMarginLeft] = useState(6);
  const [marginRight, setMarginRight] = useState(6);
  const [landscape, setLandscape] = useState(true);
  const [companyName, setCompanyName] = useState("");
  const [companyNote, setCompanyNote] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoHeight, setLogoHeight] = useState<number | "">(15);
  const [logoUploading, setLogoUploading] = useState(false);
  const [fields, setFields] = useState<ProfileField[]>(defaultFields());
  const [commentFt1, setCommentFt1] = useState(true);
  const [commentFt2, setCommentFt2] = useState(true);
  const [commentFt3, setCommentFt3] = useState(true);
  const [includeFieldLabels, setIncludeFieldLabels] = useState(true);
  const [fieldLabelsBold, setFieldLabelsBold] = useState(true);
  const [skipLeveresHentes, setSkipLeveresHentes] = useState(false);
  const [includeRouteName, setIncludeRouteName] = useState(false);
  const [notes, setNotes] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [selectedFieldType, setSelectedFieldType] = useState<FieldType | null>(null);
  const zCounterRef = useRef(0);

  const createMut = useCreateLabelPrintProfile();
  const updateMut = useUpdateLabelPrintProfile();
  const isSubmitting = createMut.isPending || updateMut.isPending;

  // Initialize / reset on open
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && existing) {
      setName(existing.name);
      setPaperWidth(Number(existing.paper_width_mm));
      setPaperHeight(Number(existing.paper_height_mm));
      setMarginTop(Number(existing.margin_top_mm));
      setMarginBottom(Number(existing.margin_bottom_mm));
      setMarginLeft(Number(existing.margin_left_mm));
      setMarginRight(Number(existing.margin_right_mm));
      setLandscape(existing.orientation === "landscape");
      setCompanyName(existing.company_name);
      setCompanyNote(existing.company_note ?? "");
      setLogoUrl(existing.logo_url);
      setLogoHeight(existing.logo_height_mm ?? "");
      const baseFields =
        existing.fields.length === 21 ? existing.fields : defaultFields();
      const inner = getInnerArea(
        Number(existing.paper_width_mm),
        Number(existing.paper_height_mm),
        Number(existing.margin_top_mm),
        Number(existing.margin_right_mm),
        Number(existing.margin_bottom_mm),
        Number(existing.margin_left_mm),
        existing.orientation === "landscape",
      );
      setFields(migrateLegacyFields(baseFields, inner.w, inner.h));
      setCommentFt1(existing.comment_includes.fritekst1);
      setCommentFt2(existing.comment_includes.fritekst2);
      setCommentFt3(existing.comment_includes.fritekst3);
      setIncludeFieldLabels(existing.include_field_labels);
      setFieldLabelsBold(existing.field_labels_bold);
      setSkipLeveresHentes(existing.skip_leveres_hentes_if_empty);
      setIncludeRouteName(existing.include_route_name);
      setNotes(existing.notes ?? "");
    } else {
      setName("");
      setPaperWidth(100);
      setPaperHeight(75);
      setMarginTop(0);
      setMarginBottom(0);
      setMarginLeft(6);
      setMarginRight(6);
      setLandscape(true);
      setCompanyName(legalEntity?.legal_name ?? "");
      setCompanyNote("");
      setLogoUrl(null);
      setLogoHeight(15);
      setFields(defaultFields());
      setCommentFt1(true);
      setCommentFt2(true);
      setCommentFt3(true);
      setIncludeFieldLabels(true);
      setFieldLabelsBold(true);
      setSkipLeveresHentes(false);
      setIncludeRouteName(false);
      setNotes("");
    }
    setNameError(null);
    setSelectedFieldType(null);
    zCounterRef.current = 100;
  }, [open, mode, existing, legalEntity]);

  const inner = useMemo(
    () =>
      getInnerArea(
        paperWidth,
        paperHeight,
        marginTop,
        marginRight,
        marginBottom,
        marginLeft,
        landscape,
      ),
    [paperWidth, paperHeight, marginTop, marginRight, marginBottom, marginLeft, landscape],
  );

  const activeFieldTypes = useMemo(() => {
    const set = new Set<FieldType>();
    for (const f of fields) if (f.include) set.add(f.field_type);
    return set;
  }, [fields]);

  const updateField = (type: FieldType, patch: Partial<ProfileField>) => {
    setFields((prev) =>
      prev.map((f) => (f.field_type === type ? { ...f, ...patch } : f)),
    );
  };

  const addFieldAt = (type: FieldType, x: number, y: number) => {
    zCounterRef.current += 1;
    const z = zCounterRef.current;
    setFields((prev) =>
      prev.map((f) => {
        if (f.field_type !== type) return f;
        const sz = defaultFieldSize(type);
        const w = f.width_mm > 0 ? f.width_mm : sz.w;
        const h = f.height_mm > 0 ? f.height_mm : sz.h;
        return {
          ...f,
          include: true,
          x_mm: clamp(x, 0, Math.max(0, inner.w - w)),
          y_mm: clamp(y, 0, Math.max(0, inner.h - h)),
          width_mm: Math.min(w, inner.w),
          height_mm: Math.min(h, inner.h),
          z_index: z,
        };
      }),
    );
    setSelectedFieldType(type);
  };

  const handleAddByClick = (type: FieldType) => {
    // Place at next vertical slot
    const sz = defaultFieldSize(type);
    const placed = fields.filter((f) => f.include);
    const maxY = placed.reduce(
      (acc, f) => Math.max(acc, f.y_mm + f.height_mm),
      0,
    );
    addFieldAt(
      type,
      0,
      Math.min(maxY + 1, Math.max(0, inner.h - sz.h)),
    );
  };

  const handleLogoUpload = async (file: File) => {
    if (!legalEntity) {
      toast.error("Velg et selskap først.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Filen må være et bilde.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logoen er for stor (maks 2 MB).");
      return;
    }
    setLogoUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "png";
      const path = `${legalEntity.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data: pub } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
      setLogoUrl(pub.publicUrl);
      toast.success("Logo lastet opp.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ukjent feil";
      toast.error(`Kunne ikke laste opp: ${msg}`);
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Profilnavn er påkrevd.");
      return;
    }
    if (!companyName.trim()) {
      toast.error("Firmanavn er påkrevd.");
      return;
    }
    if (mode === "create" && !legalEntity) {
      toast.error("Velg et selskap først.");
      return;
    }

    const payload = {
      name: trimmedName,
      paper_width_mm: paperWidth,
      paper_height_mm: paperHeight,
      margin_top_mm: marginTop,
      margin_bottom_mm: marginBottom,
      margin_left_mm: marginLeft,
      margin_right_mm: marginRight,
      orientation: (landscape ? "landscape" : "portrait") as
        | "landscape"
        | "portrait",
      company_name: companyName.trim(),
      company_note: companyNote.trim() ? companyNote.trim() : null,
      logo_url: logoUrl,
      logo_height_mm: typeof logoHeight === "number" ? logoHeight : null,
      fields,
      comment_includes: {
        fritekst1: commentFt1,
        fritekst2: commentFt2,
        fritekst3: commentFt3,
      },
      include_field_labels: includeFieldLabels,
      field_labels_bold: fieldLabelsBold,
      skip_leveres_hentes_if_empty: skipLeveresHentes,
      include_route_name: includeRouteName,
      notes: notes.trim() ? notes.trim() : null,
    };

    try {
      if (mode === "create") {
        await createMut.mutateAsync({
          ...payload,
          legal_entity_id: legalEntity!.id,
        });
        toast.success(`Profilen "${trimmedName}" er opprettet.`);
      } else {
        await updateMut.mutateAsync({ ...payload, id: existing!.id });
        toast.success("Endringene er lagret.");
      }
      onOpenChange(false);
    } catch (err) {
      if (err instanceof DuplicateProfileNameError) {
        const entityLabel = legalEntity?.legal_name ?? "dette selskapet";
        const message = `Profilnavnet "${err.profileName}" finnes allerede i ${entityLabel}.`;
        toast.error(message);
        setNameError(message);
      } else {
        const msg = err instanceof Error ? err.message : "Kunne ikke lagre.";
        toast.error(`Kunne ikke lagre: ${msg}`);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[92vh] max-h-[92vh] w-[95vw] max-w-[1400px] flex-col gap-0 overflow-hidden p-0"
      >
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          {/* HEADER */}
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-5 py-3">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="profile-name" className="sr-only">
                Profilnavn
              </Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Navn på profil"
                aria-invalid={!!nameError}
                maxLength={80}
                className="h-9 text-base font-medium"
              />
              {nameError && (
                <p className="mt-1 text-xs text-destructive">{nameError}</p>
              )}
            </div>

            <Separator orientation="vertical" className="h-8" />

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Papir</Label>
              <PaperPresetSelect
                width={paperWidth}
                height={paperHeight}
                onChange={(w, h) => {
                  setPaperWidth(w);
                  setPaperHeight(h);
                }}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="landscape"
                checked={landscape}
                onCheckedChange={setLandscape}
              />
              <Label htmlFor="landscape" className="text-xs">
                {landscape ? "Liggende" : "Stående"}
              </Label>
            </div>
          </div>

          {/* MAIN: 3 columns */}
          <div className="grid flex-1 min-h-0 grid-cols-[240px_1fr_320px]">
            {/* LEFT: palette */}
            <FieldPalette
              activeFieldTypes={activeFieldTypes}
              onDragStartField={() => {
                /* noop — drop handled in canvas */
              }}
              onClickField={handleAddByClick}
            />

            {/* MIDDLE: canvas */}
            <LabelCanvas
              paperWidth={paperWidth}
              paperHeight={paperHeight}
              marginTop={marginTop}
              marginRight={marginRight}
              marginBottom={marginBottom}
              marginLeft={marginLeft}
              landscape={landscape}
              fields={fields}
              selectedFieldType={selectedFieldType}
              companyName={companyName}
              logoUrl={logoUrl}
              includeFieldLabels={includeFieldLabels}
              onSelectField={setSelectedFieldType}
              onUpdateField={updateField}
              onAddFieldAt={addFieldAt}
              renderInlineToolbar={(field) => (
                <InlineToolbar
                  field={field}
                  onChange={(patch) => updateField(field.field_type, patch)}
                  onRemove={() => {
                    updateField(field.field_type, { include: false });
                    setSelectedFieldType(null);
                  }}
                />
              )}
            />

            {/* RIGHT: settings */}
            <div className="overflow-y-auto border-l border-border bg-muted/10 p-4">
              <SettingsAccordion
                marginTop={marginTop}
                marginRight={marginRight}
                marginBottom={marginBottom}
                marginLeft={marginLeft}
                setMarginTop={setMarginTop}
                setMarginRight={setMarginRight}
                setMarginBottom={setMarginBottom}
                setMarginLeft={setMarginLeft}
                paperWidth={paperWidth}
                paperHeight={paperHeight}
                setPaperWidth={setPaperWidth}
                setPaperHeight={setPaperHeight}
                companyName={companyName}
                setCompanyName={setCompanyName}
                companyNote={companyNote}
                setCompanyNote={setCompanyNote}
                logoUrl={logoUrl}
                setLogoUrl={setLogoUrl}
                logoHeight={logoHeight}
                setLogoHeight={setLogoHeight}
                logoUploading={logoUploading}
                onLogoFileSelected={handleLogoUpload}
                commentFt1={commentFt1}
                commentFt2={commentFt2}
                commentFt3={commentFt3}
                setCommentFt1={setCommentFt1}
                setCommentFt2={setCommentFt2}
                setCommentFt3={setCommentFt3}
                includeFieldLabels={includeFieldLabels}
                setIncludeFieldLabels={setIncludeFieldLabels}
                fieldLabelsBold={fieldLabelsBold}
                setFieldLabelsBold={setFieldLabelsBold}
                skipLeveresHentes={skipLeveresHentes}
                setSkipLeveresHentes={setSkipLeveresHentes}
                includeRouteName={includeRouteName}
                setIncludeRouteName={setIncludeRouteName}
                notes={notes}
                setNotes={setNotes}
              />
            </div>
          </div>

          {/* FOOTER */}
          <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/20 px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Avbryt
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Lagrer …"
                : mode === "create"
                  ? "Opprett profil"
                  : "Lagre endringer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// keep round1 import path stable
void round1;
