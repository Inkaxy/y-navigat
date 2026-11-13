// Oppdelt lesing av lange fakturaer. Ren modul (vitest + Deno).
//
// Når ett AI-svar blir kuttet (maks svarlengde) eller tydelig mangler linjer fra senere sider, leses
// fakturaen i sidebolker. Linjene settes sammen i sideorden FØR sumkontrollen. Hver bolk må lykkes;
// mangler én bolk, brukes ikke sammensettingen (ingen halv faktura som «ferdig»).

import type { ParsedExtraction } from "./invoiceExtraction.ts";

export interface PageChunk { from: number; to: number }

/** Maks antall bolker per faktura (kostnad/tid). Flere sider gir større bolker. */
export const MAX_CHUNKS = 8;
/** Andel av kontrollsummen som må mangle før lesingen deles opp (uten kutt). */
export const MISSING_SHARE_FOR_CHUNKING = 0.2;

export function planPageChunks(totalPages: number, maxChunks = MAX_CHUNKS): PageChunk[] {
  if (!Number.isInteger(totalPages) || totalPages < 1) return [];
  const size = Math.max(1, Math.ceil(totalPages / Math.max(1, maxChunks)));
  const out: PageChunk[] = [];
  for (let from = 1; from <= totalPages; from += size) out.push({ from, to: Math.min(totalPages, from + size - 1) });
  return out;
}

export interface ChunkDecisionInput {
  truncated: boolean;
  totalPages: number | null;
  linesSum: number | null;
  /** Kontrollsum eks. mva, allerede justert for kreditnota-fortegn. */
  expectedExcl: number | null;
  /** Høyeste sidenummer modellen oppga på linjene (null = ukjent). */
  maxPageSeen: number | null;
}

/** Skal fakturaen leses i bolker? Returnerer årsak (norsk) eller null. */
export function chunkReason(i: ChunkDecisionInput): string | null {
  if (i.totalPages == null || i.totalPages < 2) return null;
  if (i.truncated) return "svaret ble kuttet av maks svarlengde";
  if (i.linesSum == null || i.expectedExcl == null || i.expectedExcl === 0) return null;
  const missing = 1 - i.linesSum / i.expectedExcl;
  if (missing < MISSING_SHARE_FOR_CHUNKING) return null;
  if (i.maxPageSeen != null && i.maxPageSeen < i.totalPages) return `linjene stopper på side ${i.maxPageSeen} av ${i.totalPages}`;
  return `${Math.round(missing * 100)} % av kontrollsummen mangler`;
}

/** Tilleggsinstruks til modellen for én bolk. */
export function chunkHint(c: PageChunk, totalPages: number): string {
  return (
    `OPPDELT LESING: Dokumentet du får er side ${c.from}–${c.to} av ${totalPages} i samme faktura. ` +
    `Ta med ALLE linjer som står på disse sidene, også avgifter/gebyrer/frakt/pant i en oppsummering hvis den står her. ` +
    `Ikke ta med «Transport»/«Overført»/delsummer. page_number = sidenummeret i HELE fakturaen (${c.from}–${c.to}). ` +
    `Kontrollsummen gjelder hele fakturaen, ikke disse sidene: ikke prøv å få disse linjene til å gå opp mot den.`
  );
}

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const TOTAL_FIELDS = ["total_amount", "total_excl_vat", "total_vat"] as const;

function normalizePage(p: unknown, c: PageChunk): number | null {
  if (typeof p !== "number" || !Number.isInteger(p)) return null;
  if (p >= c.from && p <= c.to) return p;
  const span = c.to - c.from + 1;
  if (p >= 1 && p <= span) return p + c.from - 1; // modellen talte fra 1 i utsnittet
  return null;
}

export interface ChunkResult { chunk: PageChunk; data: ParsedExtraction | null }

/**
 * Setter sammen bolkene i sideorden. Hodefelt fra første bolk som har verdien, totaler fra siste.
 * complete=false når en bolk mangler — da skal sammensettingen ikke brukes.
 */
export function mergeChunkExtractions(results: readonly ChunkResult[]): { data: ParsedExtraction; complete: boolean; failedChunks: PageChunk[] } {
  const sorted = [...results].sort((a, b) => a.chunk.from - b.chunk.from);
  const failedChunks = sorted.filter((r) => !r.data).map((r) => r.chunk);
  const merged: Record<string, unknown> = {};
  const conf: Record<string, number> = {};
  const lines: ParsedExtraction["lines"] = [];
  for (const r of sorted) {
    if (!r.data) continue;
    for (const [k, v] of Object.entries(r.data)) {
      if (k === "lines" || k === "field_confidence" || k === "number_check_issue") continue;
      if ((TOTAL_FIELDS as readonly string[]).includes(k)) { if (v != null) merged[k] = v; continue; }
      if (merged[k] == null && v != null) merged[k] = v;
    }
    if (isRec(r.data.field_confidence)) {
      for (const [k, v] of Object.entries(r.data.field_confidence)) {
        if (typeof v === "number") conf[k] = k in conf ? Math.min(conf[k], v) : v;
      }
    }
    for (const l of r.data.lines) lines.push({ ...l, page_number: normalizePage(l.page_number, r.chunk) });
  }
  return { data: { ...merged, field_confidence: conf, lines } as ParsedExtraction, complete: failedChunks.length === 0 && sorted.length > 0, failedChunks };
}

/** Høyeste sidenummer på linjene, eller null når ingen linje har side. */
export function maxPageOf(lines: readonly { page_number?: number | null }[]): number | null {
  const ps = lines.map((l) => l.page_number).filter((p): p is number => typeof p === "number" && Number.isInteger(p));
  return ps.length ? Math.max(...ps) : null;
}
