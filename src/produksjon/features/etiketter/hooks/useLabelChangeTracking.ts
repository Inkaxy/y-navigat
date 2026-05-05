import { useEffect, useMemo, useRef } from "react";
import type { LabelChangeCounts, LabelProductRow, LabelScreenFilter } from "../types";

interface SnapshotRow {
  total_labels: number;
  unique_notes: string[];
}

type Snapshot = Record<string, SnapshotRow>;

const snapshotKey = (filter: LabelScreenFilter) =>
  `produksjon_etikett_last_seen_${filter.legalEntityId}_${filter.date}`;

function readSnapshot(key: string): Snapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(key: string, snapshot: Snapshot) {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    /* localStorage full or unavailable — silent */
  }
}

function rowsToSnapshot(rows: LabelProductRow[]): Snapshot {
  const out: Snapshot = {};
  for (const r of rows) {
    out[r.product_id] = {
      total_labels: r.total_labels,
      unique_notes: [...(r.unique_notes ?? [])].sort(),
    };
  }
  return out;
}

function notesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface UseLabelChangeTrackingResult extends LabelChangeCounts {
  resetSnapshot: () => void;
  hasSnapshot: boolean;
}

export function useLabelChangeTracking(
  filter: LabelScreenFilter | null,
  rows: LabelProductRow[] | undefined,
): UseLabelChangeTrackingResult {
  const key = filter ? snapshotKey(filter) : null;

  // Bumps state when snapshot is reset, so memo recomputes.
  const resetTickRef = useRef(0);

  const baseline = useMemo<Snapshot | null>(() => {
    if (!key) return null;
    return readSnapshot(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, resetTickRef.current]);

  const counts = useMemo<LabelChangeCounts>(() => {
    if (!rows || !baseline) {
      return { newCount: 0, changedCount: 0, deletedCount: 0 };
    }
    const current = rowsToSnapshot(rows);
    let newCount = 0;
    let changedCount = 0;
    let deletedCount = 0;

    for (const id of Object.keys(current)) {
      const prev = baseline[id];
      const cur = current[id];
      if (!prev) {
        newCount++;
      } else if (
        prev.total_labels !== cur.total_labels ||
        !notesEqual(prev.unique_notes, cur.unique_notes)
      ) {
        changedCount++;
      }
    }
    for (const id of Object.keys(baseline)) {
      if (!current[id]) deletedCount++;
    }
    return { newCount, changedCount, deletedCount };
  }, [rows, baseline]);

  // Persist a fresh snapshot the first time we see data and no baseline exists.
  useEffect(() => {
    if (!key || !rows) return;
    if (baseline) return;
    writeSnapshot(key, rowsToSnapshot(rows));
  }, [key, rows, baseline]);

  const resetSnapshot = () => {
    if (!key || !rows) return;
    writeSnapshot(key, rowsToSnapshot(rows));
    resetTickRef.current += 1;
    // Force consumers to re-render via a microtask state bump:
    // Easiest is to mutate ref + dispatch a custom event. Simpler: rely on
    // next render trigger from caller. We do a dummy state via setTimeout.
    setTimeout(() => {
      window.dispatchEvent(new Event("etiketter:snapshot-reset"));
    }, 0);
  };

  return {
    ...counts,
    resetSnapshot,
    hasSnapshot: !!baseline,
  };
}
