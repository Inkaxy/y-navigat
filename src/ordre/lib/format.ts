import { osloTodayISO, osloDateISO } from "@/lib/osloDate";
export function formatNOK(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatNumber(value: number | string | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

/** "tor 16. apr 2026" */
export function formatDateLong(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("nb-NO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** "2 timer siden", "3 dager siden". Faller tilbake til absolutt dato etter 30 dager. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  if (typeof Intl === "undefined" || typeof Intl.RelativeTimeFormat !== "function") {
    return formatDateTime(d);
  }
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat("nb-NO", { numeric: "auto" });
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(-Math.round(sec), "second");
  if (abs < 3600) return rtf.format(-Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(-Math.round(sec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(-Math.round(sec / 86400), "day");
  return formatDateTime(d);
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function hexToHsl(hex: string): string | null {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hue = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / d + 2;
        break;
      case b:
        hue = (r - g) / d + 4;
        break;
    }
    hue /= 6;
  }
  return `${Math.round(hue * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function darkenHsl(hsl: string, amount = 10): string {
  const m = hsl.match(/^(\d+)\s+(\d+)%\s+(\d+)%$/);
  if (!m) return hsl;
  const h = Number(m[1]);
  const s = Number(m[2]);
  const l = Math.max(0, Number(m[3]) - amount);
  return `${h} ${s}% ${l}%`;
}

export function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return osloDateISO(d);
}

export function todayISO(): string {
  return osloTodayISO();
}
