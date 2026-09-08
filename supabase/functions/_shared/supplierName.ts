/**
 * Normaliserer et leverandørnavn for sammenligning ved Tripletex-import.
 * Speiler src/ravarer/lib/supplierName.ts.
 */
export function normalizeSupplierName(name: string | null | undefined): string {
  if (!name) return "";
  let s = name.toLowerCase();
  s = s.replace(/[.,;:()[\]{}"'`´!?*]/g, " ");
  s = s.replace(/\ba\s*\/\s*s\b/g, " ");
  s = s.replace(/[/\\-]/g, " ");
  s = s.replace(/\b(as|asa|ans|da|sa|ab|oy|aps|gmbh|ltd|inc)\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
