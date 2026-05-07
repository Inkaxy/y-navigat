import { z } from "zod";

export const merknadSchema = z.object({
  bestilt_av: z.string().default(""),
  telefon: z.string().default(""),
  sukkerbilde: z.boolean().nullable().default(null),
  fyll: z.string().default(""),
  tekst: z.string().default(""),
  pynt: z.string().default(""),
  fritekst_1: z.string().default(""),
  fritekst_2: z.string().default(""),
  fritekst_3: z.string().default(""),
  sendes_med: z.string().default(""),
  tid: z.string().default(""),
  antall_etiketter: z.number().int().nonnegative().nullable().default(null),
});

export type Merknad = z.infer<typeof merknadSchema>;

export const emptyMerknad: Merknad = {
  bestilt_av: "",
  telefon: "",
  sukkerbilde: null,
  fyll: "",
  tekst: "",
  pynt: "",
  fritekst_1: "",
  fritekst_2: "",
  fritekst_3: "",
  sendes_med: "",
  tid: "",
  antall_etiketter: null,
};

export function isMerknadEmpty(m: Partial<Merknad> | null | undefined): boolean {
  if (!m) return true;
  return (
    !m.bestilt_av &&
    !m.telefon &&
    m.sukkerbilde == null &&
    !m.fyll &&
    !m.tekst &&
    !m.pynt &&
    !m.fritekst_1 &&
    !m.fritekst_2 &&
    !m.fritekst_3 &&
    !m.sendes_med &&
    !m.tid &&
    m.antall_etiketter == null
  );
}

/** Parse a merknad object coming from the database (may be unknown shape). Returns null if empty/invalid. */
export function parseMerknad(value: unknown): Merknad | null {
  if (value == null) return null;
  const result = merknadSchema.safeParse(value);
  if (!result.success) return null;
  return isMerknadEmpty(result.data) ? null : result.data;
}
