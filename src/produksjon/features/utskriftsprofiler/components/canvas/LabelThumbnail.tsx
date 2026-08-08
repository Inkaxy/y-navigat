import { useLayoutEffect, useRef, useState } from "react";
import { FALLBACK_FIELD_LABELS, type ProfileField, type ProfileLine } from "../../types";
import { fitFontSizePt } from "../../lib/fitText";

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
              const autoFit = f.auto_fit ?? false;
              const vAlign = f.vertical_alignment ?? "middle";
              let content: React.ReactNode;
              let measureString = "";
              if (f.field_type === "logo" && logoUrl) {
                content = (
                  <img
                    src={logoUrl}
                    alt=""
                    className="pointer-events-none h-full w-full object-contain"
                  />
                );
              } else if (f.field_type === "firmanavn") {
                measureString = companyName || FALLBACK_FIELD_LABELS.firmanavn;
                content = measureString;
              } else {
                measureString = `[${FALLBACK_FIELD_LABELS[f.field_type]}]`;
                content = measureString;
              }
              const effectivePt =
                autoFit && f.field_type !== "logo"
                  ? fitFontSizePt(measureString, f.font_size, f.width_mm, f.height_mm, {
                      bold: f.bold,
                    })
                  : f.font_size;
              const fontPx = Math.max(4, effectivePt * pxPerMm * 0.32);
              const alignItems =
                vAlign === "top"
                  ? "flex-start"
                  : vAlign === "bottom"
                    ? "flex-end"
                    : "center";
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
                    className="flex h-full w-full px-0.5 leading-tight"
                    style={{
                      fontSize: fontPx,
                      fontWeight: f.bold ? 700 : 400,
                      alignItems,
                      justifyContent:
                        f.alignment === "center"
                          ? "center"
                          : f.alignment === "right"
                            ? "flex-end"
                            : "flex-start",
                      textAlign: f.alignment,
                    }}
                  >
                    <span
                      className={
                        autoFit
                          ? "block w-full whitespace-pre-wrap break-words"
                          : "block w-full truncate"
                      }
                    >
                      {content}
                    </span>
                  </div>
                </div>
              );
            })}
            {lines.map((ln) => {
              const isH = ln.orientation === "horizontal";
              return (
                <div
                  key={ln.id}
                  className="pointer-events-none absolute"
                  style={{
                    left: ln.x_mm * pxPerMm,
                    top: ln.y_mm * pxPerMm,
                    width: isH ? ln.length_mm * pxPerMm : Math.max(0.5, ln.thickness_mm * pxPerMm),
                    height: isH ? Math.max(0.5, ln.thickness_mm * pxPerMm) : ln.length_mm * pxPerMm,
                    background: "#555",
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
