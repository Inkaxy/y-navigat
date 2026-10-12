/**
 * Ventende operasjoner per bruker + firma, holdbart i nettleseren (overlever avmontering og omlasting).
 * Et innslag fryser op-id + innhold FØR kallet. Ukjent utfall blir liggende til en ny sending med
 * SAMME op-id gir et kjent svar. Synkron lås per nøkkel hindrer dobbeltsending.
 */
export interface PendingOp<P = unknown> {
  key: string; opId: string; sig: string; payload: P; state: "inflight" | "unknown"; at: string;
}

type Listener = () => void;

export class PendingStore {
  private ops = new Map<string, PendingOp>();
  private locks = new Set<string>();
  private listeners = new Set<Listener>();
  private version = 0;

  constructor(private readonly storageKey: string | null, private readonly storage: Storage | null) {
    if (!storageKey || !storage) return;
    try {
      const raw = storage.getItem(storageKey);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) for (const o of arr) if (isOp(o)) this.ops.set(o.key, { ...o, state: "unknown" }); // inflight ved omlasting = ukjent
    } catch { /* korrupt lagring: ignorer, ingenting sendes automatisk */ }
  }
  get(key: string): PendingOp | undefined { return this.ops.get(key); }
  all(): PendingOp[] { return [...this.ops.values()]; }
  getVersion(): number { return this.version; }
  tryLock(key: string): boolean { if (this.locks.has(key)) return false; this.locks.add(key); this.emit(); return true; }
  unlock(key: string): void { this.locks.delete(key); this.emit(); }
  isLocked(key: string): boolean { return this.locks.has(key); }
  put(op: PendingOp): void { this.ops.set(op.key, op); this.persist(); }
  mark(key: string, opId: string, state: PendingOp["state"]): void {
    const o = this.ops.get(key); if (o && o.opId === opId) { this.ops.set(key, { ...o, state }); this.persist(); }
  }
  /** Fjerner bare hvis innslaget fortsatt er samme operasjon. */
  remove(key: string, opId: string): void {
    const o = this.ops.get(key); if (o && o.opId === opId) { this.ops.delete(key); this.persist(); }
  }
  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private persist() {
    if (this.storageKey && this.storage) {
      try { this.storage.setItem(this.storageKey, JSON.stringify(this.all())); } catch { /* full lagring: minnet gjelder fortsatt */ }
    }
    this.emit();
  }
  private emit() { this.version++; for (const l of this.listeners) l(); }
}

function isOp(o: unknown): o is PendingOp {
  if (typeof o !== "object" || o === null) return false;
  const r = o as Record<string, unknown>;
  return typeof r.key === "string" && typeof r.opId === "string" && typeof r.sig === "string" && typeof r.at === "string" && "payload" in r;
}

const stores = new Map<string, PendingStore>();
/** Én butikk per bruker + firma. Uten bruker-ID: bare minne (aldri delt mellom brukere). */
export function pendingStoreFor(userId: string | null, entity: string): PendingStore {
  const id = `${userId ?? "anon"}:${entity}`;
  let s = stores.get(id);
  if (!s) {
    const storage = typeof window !== "undefined" && userId ? window.localStorage : null;
    s = new PendingStore(userId ? `vt:pending:v2:${id}` : null, storage);
    stores.set(id, s);
  }
  return s;
}
/** Bare for tester. */
export function resetPendingStores(): void { stores.clear(); }
