/**
 * Holdbare redigeringsutkast per bruker + firma + telling + linje. Et utkast er IKKE sendt:
 * det er inntastede felter bundet til revisjonen redigeringen startet fra. Overlever bytte av
 * liste/filter/fane og omlasting i samme nettleser. Lagringsfeil (full/blokkert lagring) gjøres
 * synlige via `lastError` — utkastet ligger da bare i minnet.
 */
export interface LineEditDraft {
  countId: string; lineId: string; baseRevision: number;
  baseTexts: string[]; baseNote: string; texts: string[]; note: string; at: string;
}
type Listener = () => void;

export class DraftStore {
  private drafts = new Map<string, LineEditDraft>();
  private listeners = new Set<Listener>();
  private version = 0;
  lastError: string | null = null;

  constructor(private readonly storageKey: string | null, private readonly storage: Storage | null) {
    if (!storageKey || !storage) return;
    try {
      const raw = storage.getItem(storageKey);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) for (const d of arr) if (isDraft(d)) this.drafts.set(d.lineId, d);
    } catch {
      this.lastError = "Lagrede utkast kunne ikke leses i denne nettleseren. Ingen verdier er sendt.";
    }
  }
  get(lineId: string): LineEditDraft | undefined { return this.drafts.get(lineId); }
  forCount(countId: string): LineEditDraft[] { return [...this.drafts.values()].filter(d => d.countId === countId); }
  getVersion(): number { return this.version; }
  put(d: LineEditDraft): void {
    const cur = this.drafts.get(d.lineId);
    if (cur && JSON.stringify({ ...cur, at: "" }) === JSON.stringify({ ...d, at: "" })) return;
    this.drafts.set(d.lineId, d); this.persist();
  }
  remove(lineId: string): void { if (this.drafts.delete(lineId)) this.persist(); }
  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private persist() {
    if (this.storageKey && this.storage) {
      try { this.storage.setItem(this.storageKey, JSON.stringify([...this.drafts.values()])); this.lastError = null; }
      catch { this.lastError = "Utkast kan ikke lagres i nettleseren (lagringen er full eller blokkert). De ligger bare på denne siden til du lagrer."; }
    }
    this.version++; for (const l of this.listeners) l();
  }
}

function isDraft(o: unknown): o is LineEditDraft {
  if (typeof o !== "object" || o === null) return false;
  const r = o as Record<string, unknown>;
  const strs = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string");
  return typeof r.countId === "string" && typeof r.lineId === "string" && Number.isInteger(r.baseRevision)
    && strs(r.baseTexts) && strs(r.texts) && typeof r.note === "string" && typeof r.baseNote === "string" && typeof r.at === "string";
}

const stores = new Map<string, DraftStore>();
/** Én butikk per bruker + firma. Uten bruker-ID: bare minne. */
export function draftStoreFor(userId: string | null, entity: string): DraftStore {
  const id = `${userId ?? "anon"}:${entity}`;
  let s = stores.get(id);
  if (!s) {
    let storage: Storage | null = null;
    try { storage = typeof window !== "undefined" && userId ? window.localStorage : null; } catch { storage = null; }
    s = new DraftStore(userId ? `vt:drafts:v1:${id}` : null, storage);
    if (userId && !storage) s.lastError = "Nettleseren tillater ikke lokal lagring. Utkast ligger bare på denne siden.";
    stores.set(id, s);
  }
  return s;
}
export function resetDraftStores(): void { stores.clear(); }
