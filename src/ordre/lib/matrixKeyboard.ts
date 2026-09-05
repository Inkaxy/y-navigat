/**
 * Tastaturnavigasjon i leveringskalender-matrisen.
 *
 * Cellene merkes med `data-cell="date|tour|product"` og rutenett-koordinater
 * (`data-cell-row` / `data-cell-col`), slik at navigasjon kan skje uten at
 * matrisen holder fokus-state i React (som ville tvunget full re-render).
 */

function cellInputs(from: HTMLElement): HTMLInputElement[] {
  const table = from.closest("table");
  if (!table) return [];
  return Array.from(table.querySelectorAll<HTMLInputElement>("input[data-cell]"));
}

function focusInput(el: HTMLInputElement | null | undefined): boolean {
  if (!el) return false;
  el.focus();
  el.select();
  return true;
}

/** Flytt fokus til cellen på (row, col). Returnerer false om den ikke finnes. */
export function focusMatrixCell(from: HTMLElement, row: number, col: number): boolean {
  const table = from.closest("table");
  if (!table) return false;
  return focusInput(
    table.querySelector<HTMLInputElement>(
      `input[data-cell-row="${row}"][data-cell-col="${col}"]`,
    ),
  );
}

/** Flytt fokus n celler fram/tilbake i dokumentrekkefølge (Tab/Shift+Tab). */
export function focusMatrixCellByOffset(from: HTMLElement, delta: number): boolean {
  const list = cellInputs(from);
  const idx = list.indexOf(from as HTMLInputElement);
  if (idx < 0) return false;
  return focusInput(list[idx + delta]);
}
