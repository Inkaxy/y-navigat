import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  defaultFieldSize,
  defaultFields,
  type FieldType,
  type LabelPrintProfile,
  type ProfileField,
  type ProfileLine,
} from "../types";
import {
  DuplicateProfileNameError,
  useCreateLabelPrintProfile,
  useUpdateLabelPrintProfile,
} from "../hooks/useLabelPrintProfileMutations";
import type { LegalEntityOption } from "@/produksjon/features/produksjonsavdelinger/hooks/useLegalEntities";
import { LabelCanvas } from "./canvas/LabelCanvas";
import { EditorTopbar } from "./canvas/EditorTopbar";
import { LeftPanel } from "./canvas/LeftPanel";
import { RightInspector } from "./canvas/RightInspector";
import { StatusBar } from "./canvas/StatusBar";
import { SettingsSheet } from "./canvas/SettingsSheet";
import { getInnerArea, migrateLegacyFields, clamp } from "../lib/canvasUtils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  legalEntity: LegalEntityOption | null;
  existing?: LabelPrintProfile | null;
}

const LOGO_BUCKET = "label-logos";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = Math.round(diff / 60000);
    if (min < 1) return "nettopp";
    if (min < 60) return `${min} min siden`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} t siden`;
    const days = Math.round(hr / 24);
    if (days < 7) return `${days} d siden`;
    return d.toLocaleDateString("nb-NO", { day: "2-digit", month: "2-digit" });
  } catch {
    return iso;
  }
}

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
  const [lines, setLines] = useState<ProfileLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
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
  const [editorMode, setEditorMode] = useState<"design" | "preview">("design");
  const [zoom, setZoom] = useState(4);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      // Merge: start from defaultFields() (full set incl. nye felt) og overlay lagrede.
      const existingMap = new Map(
        (existing.fields ?? []).map((f) => [f.field_type, f]),
      );
      const baseFields = defaultFields().map((d) => {
        const saved = existingMap.get(d.field_type);
        if (!saved) return d;
        return { ...d, ...saved, show_label: saved.show_label ?? true };
      });
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
      setLines(Array.isArray(existing.lines) ? existing.lines : []);
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
      setLines([]);
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
    setEditorMode("design");
    setZoom(4);
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

  const selected = useMemo(
    () =>
      selectedFieldType
        ? fields.find((f) => f.field_type === selectedFieldType && f.include) ?? null
        : null,
    [fields, selectedFieldType],
  );

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
    const sz = defaultFieldSize(type);
    const placed = fields.filter((f) => f.include);
    const maxY = placed.reduce(
      (acc, f) => Math.max(acc, f.y_mm + f.height_mm),
      0,
    );
    addFieldAt(type, 0, Math.min(maxY + 1, Math.max(0, inner.h - sz.h)));
  };

  const addLine = (orientation: "horizontal" | "vertical") => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isH = orientation === "horizontal";
    const length = isH
      ? Math.min(Math.max(20, inner.w * 0.6), inner.w)
      : Math.min(Math.max(15, inner.h * 0.6), inner.h);
    const newLine: ProfileLine = {
      id,
      orientation,
      x_mm: isH ? Math.max(0, (inner.w - length) / 2) : Math.max(0, inner.w / 2),
      y_mm: isH ? Math.max(0, inner.h / 2) : Math.max(0, (inner.h - length) / 2),
      length_mm: length,
      thickness_mm: 0.3,
    };
    setLines((prev) => [...prev, newLine]);
    setSelectedFieldType(null);
    setSelectedLineId(id);
  };

  const updateLine = (id: string, patch: Partial<ProfileLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
    setSelectedLineId((s) => (s === id ? null : s));
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
      toast.error("Profilnavn er påkrevd.");
      return;
    }
    if (!companyName.trim()) {
      toast.error("Firmanavn er påkrevd. Åpne innstillinger for å fylle inn.");
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
      lines,
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

  const subtitle =
    mode === "edit" && existing
      ? `${activeFieldTypes.size} av ${fields.length} felter · sist endret ${formatRelative(existing.updated_at)}`
      : `${activeFieldTypes.size} felt på etiketten · ny profil`;

  const isPreview = editorMode === "preview";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[94vh] max-h-[94vh] w-[97vw] max-w-[1600px] flex-col gap-0 overflow-hidden p-0"
      >
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          {/* Hidden but accessible name field — surface via inline editor in topbar */}
          <div className="sr-only">
            <Label htmlFor="profile-name">Profilnavn</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <EditorTopbar
            name={name}
            subtitle={subtitle}
            paperWidth={paperWidth}
            paperHeight={paperHeight}
            landscape={landscape}
            mode={editorMode}
            saved={mode === "edit" && existing ? `Lagret · ${new Date(existing.updated_at).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}` : null}
            isSubmitting={isSubmitting}
            isCreate={mode === "create"}
            onChangePaperWidth={setPaperWidth}
            onChangePaperHeight={setPaperHeight}
            onToggleLandscape={setLandscape}
            onChangeMode={setEditorMode}
            onAddHorizontalLine={() => addLine("horizontal")}
            onAddVerticalLine={() => addLine("vertical")}
            onOpenSettings={() => setSettingsOpen(true)}
            onCancel={() => onOpenChange(false)}
          />

          {/* Profile name editable strip */}
          <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Navn på profil"
              maxLength={80}
              aria-invalid={!!nameError}
              className="h-8 max-w-[320px] border-0 bg-transparent px-0 text-sm font-semibold tracking-tight shadow-none focus-visible:ring-0"
            />
            {nameError && (
              <span className="text-xs text-destructive">{nameError}</span>
            )}
          </div>

          {/* Main: 3 columns */}
          <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr_320px]">
            <LeftPanel
              fields={fields}
              activeFieldTypes={activeFieldTypes}
              selectedFieldType={selectedFieldType}
              onClickField={handleAddByClick}
              onSelectField={setSelectedFieldType}
              onUpdateField={updateField}
            />

            <div className="flex min-w-0 flex-col bg-muted/30">
              <LabelCanvas
                paperWidth={paperWidth}
                paperHeight={paperHeight}
                marginTop={marginTop}
                marginRight={marginRight}
                marginBottom={marginBottom}
                marginLeft={marginLeft}
                landscape={landscape}
                fields={fields}
                selectedFieldType={isPreview ? null : selectedFieldType}
                companyName={companyName}
                logoUrl={logoUrl}
                includeFieldLabels={includeFieldLabels}
                onSelectField={setSelectedFieldType}
                onUpdateField={updateField}
                onAddFieldAt={addFieldAt}
                readOnly={isPreview}
                zoom={zoom}
              />
            </div>

            <RightInspector
              selected={selected}
              innerW={inner.w}
              innerH={inner.h}
              onChange={(patch) => selected && updateField(selected.field_type, patch)}
              onRemove={() => {
                if (!selected) return;
                updateField(selected.field_type, { include: false });
                setSelectedFieldType(null);
              }}
            />
          </div>

          <StatusBar
            placedCount={activeFieldTypes.size}
            selected={selected}
            zoomPct={Math.round((zoom / 4) * 100)}
            onZoomIn={() => setZoom((z) => Math.min(10, z + 1))}
            onZoomOut={() => setZoom((z) => Math.max(2, z - 1))}
            onZoomReset={() => setZoom(4)}
          />

          <SettingsSheet
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
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
        </form>
      </DialogContent>
    </Dialog>
  );
}
