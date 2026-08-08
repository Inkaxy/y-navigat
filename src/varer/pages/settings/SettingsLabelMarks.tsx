import { useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageOff, Loader2, Save, Trash2, Upload } from "lucide-react";
import { useAppContext } from "@/varer/context/AppContext";
import { GRAIN_LEVELS, GRAIN_MARK_KEY } from "@/varer/lib/breadscale";
import {
  useDeleteLabelMark,
  useLabelMarks,
  useUpdateLabelMark,
  useUploadLabelMark,
  type LabelMark,
} from "@/varer/hooks/useLabelMarks";

/** Bakeriets egne, rettighetsbelagte merkefiler (Brødskala'n) — vi henter aldri logoer fra nettet. */
export default function SettingsLabelMarks() {
  const { legalEntityId, canWrite } = useAppContext();
  const marksQuery = useLabelMarks(legalEntityId ?? undefined);
  const upload = useUploadLabelMark(legalEntityId ?? undefined);
  const update = useUpdateLabelMark();
  const del = useDeleteLabelMark();
  const marks = marksQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Merker på forbrukeretiketten</CardTitle>
        <CardDescription>
          Brødskala'n eies av Baker- og Konditorbransjens Landsforening, og de offisielle filene kan ikke lastes ned
          fritt. Last opp de variantene bakeriet har rett til å bruke — én per grovhetsnivå. Mangler filen, tegner vi
          vår egen enkle skala i stedet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {marksQuery.isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          GRAIN_LEVELS.map((lvl) => {
            const key = GRAIN_MARK_KEY[lvl.key];
            const mark = marks.find((m) => m.mark_key === key);
            return (
              <MarkRow
                key={key}
                markKey={key}
                title={`Brødskala'n — ${lvl.label}`}
                mark={mark}
                canWrite={canWrite}
                uploading={upload.isPending}
                onUpload={(file) => upload.mutate({ mark_key: key, file })}
                onSave={(patch) => mark && update.mutate({ id: mark.id, ...patch })}
                onDelete={() => mark && del.mutate(mark)}
              />
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function MarkRow({
  title,
  mark,
  canWrite,
  uploading,
  onUpload,
  onSave,
  onDelete,
}: {
  markKey: string;
  title: string;
  mark: LabelMark | undefined;
  canWrite: boolean;
  uploading: boolean;
  onUpload: (file: File) => void;
  onSave: (patch: { licence_note: string | null; valid_to: string | null }) => void;
  onDelete: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState(mark?.licence_note ?? "");
  const [validTo, setValidTo] = useState(mark?.valid_to?.slice(0, 10) ?? "");

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-md border p-3">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border bg-muted/30">
        {mark?.signedUrl ? (
          <img src={mark.signedUrl} alt={title} className="h-full w-full object-contain p-1" />
        ) : (
          <ImageOff className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-[220px] flex-1 space-y-2">
        <div className="text-sm font-medium">{title}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Lisensnotat</Label>
            <Input
              value={note}
              disabled={!canWrite || !mark}
              placeholder="f.eks. avtale med BKLF, ref. 2026-04"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Avtalen utløper</Label>
            <Input type="date" value={validTo} disabled={!canWrite || !mark} onChange={(e) => setValidTo(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" disabled={!canWrite || uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
          {mark ? "Bytt fil" : "Last opp"}
        </Button>
        {mark && (
          <>
            <Button size="sm" variant="outline" disabled={!canWrite} onClick={() => onSave({ licence_note: note || null, valid_to: validTo || null })}>
              <Save className="mr-1.5 h-4 w-4" /> Lagre
            </Button>
            <Button size="sm" variant="ghost" disabled={!canWrite} onClick={onDelete}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Fjern
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
