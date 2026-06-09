import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { KeypadData, KeypadButton } from "@/kiosk/hooks/useKeypadLayout";
import { cn } from "@/lib/utils";

interface Props {
  data: NonNullable<KeypadData>;
}

export function KeypadGrid({ data }: Props) {
  const { layout, pages, buttons } = data;
  const sortedPages = useMemo(
    () => [...pages].sort((a, b) => a.sort_order - b.sort_order),
    [pages],
  );
  const [pageId, setPageId] = useState<string | null>(
    sortedPages[0]?.id ?? null,
  );

  const pageButtons = useMemo(
    () => buttons.filter((b) => b.page_id === pageId),
    [buttons, pageId],
  );

  const handleClick = (b: KeypadButton) => {
    console.log("[kiosk] keypad button click", {
      id: b.id,
      type: b.button_type,
      product_id: b.product_id,
      function_code: b.function_code,
      label: b.display_label,
    });
    toast(b.display_label ?? "(uten etikett)", {
      description: `type=${b.button_type}`,
    });
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {sortedPages.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {sortedPages.map((p) => (
            <button
              key={p.id}
              onClick={() => setPageId(p.id)}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                p.id === pageId
                  ? "bg-amber-500 text-[#1B1410]"
                  : "bg-white/5 text-[#F4ECDC]/70 hover:bg-white/10",
              )}
            >
              {p.page_name}
            </button>
          ))}
        </div>
      )}

      {pageButtons.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 p-12 text-center">
          <div>
            <p className="text-lg font-medium text-[#F4ECDC]/80">
              Ingen knapper på denne siden
            </p>
            <p className="mt-2 text-sm text-[#F4ECDC]/50">
              Konfigurer tastatur i POS Styring → Tastatur.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="grid flex-1 gap-2"
          style={{
            gridTemplateColumns: `repeat(${layout.grid_cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout.grid_rows}, minmax(72px, 1fr))`,
          }}
        >
          {pageButtons.map((b) => (
            <button
              key={b.id}
              onClick={() => handleClick(b)}
              className="flex flex-col items-center justify-center rounded-xl border border-white/5 p-2 text-center transition-all active:scale-[0.97]"
              style={{
                gridColumn: `${b.grid_x + 1} / span ${b.grid_width || 1}`,
                gridRow: `${b.grid_y + 1} / span ${b.grid_height || 1}`,
                backgroundColor: b.background_color ?? "rgba(255,255,255,0.06)",
                color: b.text_color ?? "#F4ECDC",
              }}
            >
              {b.image_url && (
                <img
                  src={b.image_url}
                  alt=""
                  className="mb-1 max-h-12 max-w-full object-contain"
                  draggable={false}
                />
              )}
              <span className="text-sm font-semibold leading-tight">
                {b.display_label ?? "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
