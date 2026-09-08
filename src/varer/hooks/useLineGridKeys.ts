/**
 * Ren tastaturnavigasjon over et logisk rutenett av oppskriftslinjer.
 * Hooken eier ingen DOM — den bare regner ut hvilken celle som skal ha fokus
 * og varsler eieren via `onFocusChange`.
 */
import { useCallback, useState } from "react";

export type GridColumn = "name" | "quantity" | "unit" | "percent" | "waste";

export const GRID_COLUMNS: GridColumn[] = ["name", "quantity", "unit", "percent", "waste"];

export interface GridFocus {
  lineId: string;
  column: GridColumn;
}

export interface UseLineGridKeysOptions {
  lineIds: string[];
  /** Kalles når fokus skal flyttes; hooken eier ikke DOM-en. */
  onFocusChange: (focus: GridFocus) => void;
  /** Enter på siste celle i siste rad: legg til ny linje og returnér id-en. */
  onAppendLine: () => string | null;
}

export interface UseLineGridKeysResult {
  focus: GridFocus | null;
  setFocus: (focus: GridFocus | null) => void;
  /** Kobles på hver celle: returnerer en onKeyDown-handler. */
  handleKeyDown: (focus: GridFocus) => (e: React.KeyboardEvent) => void;
}

export function useLineGridKeys(options: UseLineGridKeysOptions): UseLineGridKeysResult {
  const { lineIds, onFocusChange, onAppendLine } = options;
  const [focus, setFocus] = useState<GridFocus | null>(null);

  const moveTo = useCallback(
    (next: GridFocus | null) => {
      setFocus(next);
      if (next) onFocusChange(next);
    },
    [onFocusChange],
  );

  const handleKeyDown = useCallback(
    (current: GridFocus) => (e: React.KeyboardEvent) => {
      const rowIndex = lineIds.indexOf(current.lineId);
      if (rowIndex === -1) return; // ugyldig id — ignorer trygt
      const colIndex = GRID_COLUMNS.indexOf(current.column);
      if (colIndex === -1) return;

      if (e.key === "Escape") {
        e.preventDefault();
        setFocus(null);
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        let nextCol = colIndex + dir;
        let nextRow = rowIndex;
        if (nextCol < 0) {
          nextCol = GRID_COLUMNS.length - 1;
          nextRow -= 1;
        } else if (nextCol >= GRID_COLUMNS.length) {
          nextCol = 0;
          nextRow += 1;
        }
        if (nextRow < 0 || nextRow >= lineIds.length) return;
        moveTo({ lineId: lineIds[nextRow], column: GRID_COLUMNS[nextCol] });
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const nextRow = rowIndex + (e.key === "ArrowDown" ? 1 : -1);
        if (nextRow < 0 || nextRow >= lineIds.length) return;
        moveTo({ lineId: lineIds[nextRow], column: current.column });
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // La nettleseren styre markøren i feltet — ingen navigasjon her.
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (rowIndex < lineIds.length - 1) {
          moveTo({ lineId: lineIds[rowIndex + 1], column: current.column });
          return;
        }
        const newId = onAppendLine();
        if (newId) moveTo({ lineId: newId, column: "name" });
        return;
      }
    },
    [lineIds, moveTo, onAppendLine],
  );

  return { focus, setFocus, handleKeyDown };
}
