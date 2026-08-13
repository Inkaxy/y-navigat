// Offisielle Yr/MET-værsymboler (metno/weathericons, MIT) som lokale assets.
const modules = import.meta.glob("./*.svg", { eager: true, query: "?url", import: "default" }) as Record<
  string,
  string
>;

const BY_CODE: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const code = path.replace("./", "").replace(/\.svg$/, "");
  BY_CODE[code] = url;
}

/** Returnerer URL til værsymbolet, eller null hvis koden er ukjent. */
export function weatherIconUrl(symbolCode: string): string | null {
  if (BY_CODE[symbolCode]) return BY_CODE[symbolCode];
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, "");
  return BY_CODE[base] ?? BY_CODE[`${base}_day`] ?? null;
}
