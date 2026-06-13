import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageOff, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { KEYPAD_FUNCTIONS } from "@/pos_styring/keypad/functions";

const BUCKET = "pos-product-images";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

type Row = {
  id: string;
  function_code: string;
  storage_path: string;
  updated_at: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legalEntityId: string | null;
}

export function FunctionImagesDialog({ open, onOpenChange, legalEntityId }: Props) {
  const qc = useQueryClient();
  const queryKey = ["pos-function-images", legalEntityId];

  const { data: rows = [], isLoading } = useQuery({
    queryKey,
    enabled: open && !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_function_images")
        .select("id, function_code, storage_path, updated_at")
        .eq("legal_entity_id", legalEntityId!);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const byCode = new Map(rows.map((r) => [r.function_code, r]));

  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (rows.length === 0) {
      setSignedUrls({});
      return;
    }
    const paths = rows.map((r) => r.storage_path);
    supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, 3600)
      .then(({ data, error }) => {
        if (error) return;
        const m: Record<string, string> = {};
        for (const r of data ?? []) {
          if (r.path && r.signedUrl) m[r.path] = r.signedUrl;
        }
        setSignedUrls(m);
      });
  }, [rows]);

  const upload = useMutation({
    mutationFn: async ({ code, file }: { code: string; file: File }) => {
      if (!legalEntityId) throw new Error("Mangler selskap");
      if (!ALLOWED.includes(file.type)) throw new Error("Kun JPG/PNG/WEBP er støttet");
      if (file.size > MAX_BYTES) throw new Error("Maks 5 MB");
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${legalEntityId}/_functions/${code}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const existing = byCode.get(code);
      const { error: dbErr } = await supabase
        .from("pos_function_images")
        .upsert(
          {
            legal_entity_id: legalEntityId,
            function_code: code,
            storage_path: path,
          },
          { onConflict: "legal_entity_id,function_code" },
        );
      if (dbErr) throw dbErr;

      if (existing?.storage_path && existing.storage_path !== path) {
        await supabase.storage.from(BUCKET).remove([existing.storage_path]);
      }
    },
    onSuccess: () => {
      toast.success("Bilde lastet opp");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["kiosk-keypad"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: async (row: Row) => {
      const { error } = await supabase
        .from("pos_function_images")
        .delete()
        .eq("id", row.id);
      if (error) throw error;
      await supabase.storage.from(BUCKET).remove([row.storage_path]);
    },
    onSuccess: () => {
      toast.success("Bilde fjernet");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["kiosk-keypad"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Funksjonsbilder</DialogTitle>
          <DialogDescription>
            Last opp ett bilde per funksjon. Brukes som standard på alle tastatur-layouts
            for valgt selskap. Kan overstyres på enkelt-knapp.
          </DialogDescription>
        </DialogHeader>

        {!legalEntityId ? (
          <p className="text-sm text-muted-foreground">Velg selskap først.</p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {KEYPAD_FUNCTIONS.map((fn) => {
              const row = byCode.get(fn.code);
              const url = row ? signedUrls[row.storage_path] : null;
              return (
                <FunctionTile
                  key={fn.code}
                  label={fn.label}
                  code={fn.code}
                  imageUrl={url ?? null}
                  busy={upload.isPending || remove.isPending}
                  onUpload={(file) => upload.mutate({ code: fn.code, file })}
                  onRemove={row ? () => remove.mutate(row) : undefined}
                />
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FunctionTile({
  label,
  code,
  imageUrl,
  busy,
  onUpload,
  onRemove,
}: {
  label: string;
  code: string;
  imageUrl: string | null;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{label}</p>
          <p className="truncate text-xs text-muted-foreground">{code}</p>
        </div>
      </div>
      <div className="mt-2 aspect-square w-full overflow-hidden rounded-md border border-border bg-muted/30 flex items-center justify-center">
        {imageUrl ? (
          <img src={imageUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <ImageOff className="h-8 w-8 opacity-40" />
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-1.5 h-4 w-4" />
          {imageUrl ? "Erstatt" : "Last opp"}
        </Button>
        {onRemove && (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
            <Trash2 className="mr-1.5 h-4 w-4" /> Fjern
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}
