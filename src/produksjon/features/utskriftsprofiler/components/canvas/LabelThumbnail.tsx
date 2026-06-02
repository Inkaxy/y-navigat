import { useLayoutEffect, useRef, useState } from "react";
import { FIELD_LABELS, type ProfileField, type ProfileLine } from "../../types";

interface Props {
  paperWidth: number;
  paperHeight: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  landscape: boolean;
  fields: ProfileField[];
  lines?: ProfileLine[];
  companyName: string;
  logoUrl: string | null;
}

/**
 * Lett, auto-skalerende preview av en etikett — beregnet for å vises i kort/lister.
 * Ingen scroll, ingen rulers, ingen interaksjon. Skalerer alltid for å fylle
 * tilgjengelig plass uten å renne over kanten.
 */
export function LabelThumbnail({
  paperWidth,
  paperHeight,
  marginTop,
  marginRight,
  marginBottom,
  marginLeft,
  landscape,
  fields,
  lines = [],
  companyName,
  logoUrl,
}: Props) {
  const paperW = landscape ? paperWidth : paperHeight;
  const paperH = landscape ? paperHeight : paperWidth;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [pxPerMm, setPxPerMm] = useState(1);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // 8px innvendig polstring rundt papiret
      const pad = 8;
      const fitW = (rect.width - pad * 2) / paperW;
      const fitH = (rect.height - pad * 2) / paperH;
      setPxPerMm(Math.max(0.1, Math.min(fitW, fitH)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [paperW, paperH]);

  const included = fields
    .filter((f) => f.include)
    .sort((a, b) => a.z_index - b.z_index);

  return (
    <div
      ref={wrapRef}
      className="flex h-full w-full items-center justify-center overflow-hidden"
    >
      <div
        className="relative bg-white shadow-sm ring-1 ring-border"
        style={{ width: paperW * pxPerMm, height: paperH * pxPerMm }}
      >
        <div
          className="relative h-full w-full"
          style={{
            paddingTop: marginTop * pxPerMm,
            paddingRight: marginRight * pxPerMm,
            paddingBottom: marginBottom * pxPerMm,
            paddingLeft: marginLeft * pxPerMm,
          }}
        >
          <div className="relative h-full w-full">
            {included.map((f) => {
              const fontPx = Math.max(4, f.font_size * pxPerMm * 0.32);
              let content: React.ReactNode;
              if (f.field_type === "logo" && logoUrl) {
                content = (
                  <img
                    src={logoUrl}
                    alt=""
                    className="pointer-events-none h-full w-full object-contain"
                  />
                );
              } else if (f.field_type === "firmanavn") {
                content = companyName || FIELD_LABELS.firmanavn;
              } else {
                content = `[${FIELD_LABELS[f.field_type]}]`;
              }
              return (
                <div
                  key={f.field_type}
                  className="absolute overflow-hidden"
                  style={{
                    left: f.x_mm * pxPerMm,
                    top: f.y_mm * pxPerMm,
                    width: f.width_mm * pxPerMm,
                    height: f.height_mm * pxPerMm,
                    border: f.show_border ? "0.5px solid #999" : undefined,
                    borderBottom:
                      f.show_line && !f.show_border
                        ? "0.5px solid #999"
                        : undefined,
                  }}
                >
                  <div
                    className="flex h-full w-full items-center px-0.5 leading-tight"
                    style={{
                      fontSize: fontPx,
                      fontWeight: f.bold ? 700 : 400,
                      justifyContent:
                        f.alignment === "center"
                          ? "center"
                          : f.alignment === "right"
                            ? "flex-end"
                            : "flex-start",
                      textAlign: f.alignment,
                    }}
                  >
                    <span className="truncate">{content}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
