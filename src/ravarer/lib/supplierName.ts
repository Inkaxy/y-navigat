/**
 * Normaliserer et leverandørnavn for sammenligning: små bokstaver, uten
 * selskapsform («AS», «ASA», «A/S», «ANS», «DA»), uten tegnsetting og uten
 * doble mellomrom. Gjør at «Bakeriservice AS» og «bakeriservice» regnes som
 * samme leverandør ved import fra Tripletex.
 *
 * Denne må holdes i synk med supabase/functions/_shared/supplierName.ts.
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
