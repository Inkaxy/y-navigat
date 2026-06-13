export type KeypadFunctionDef = {
  code: string;
  label: string;
};

export const KEYPAD_FUNCTIONS: KeypadFunctionDef[] = [
  { code: "discount", label: "Rabatt" },
  { code: "void_last", label: "Annuller siste linje" },
  { code: "open_drawer", label: "Åpne kasseskuff" },
  { code: "price_override", label: "Overstyr pris" },
  { code: "customer_lookup", label: "Søk kunde" },
  { code: "kakebygger", label: "Kakebygger" },
];

export function functionLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return KEYPAD_FUNCTIONS.find((f) => f.code === code)?.label ?? code;
}
