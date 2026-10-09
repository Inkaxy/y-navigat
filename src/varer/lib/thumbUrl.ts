/**
 * Gjør en offentlig Supabase Storage-URL om til en liten, komprimert miniatyr
 * via bildetransformasjon. Ukjente URL-er returneres uendret.
 */
export function thumbUrl(url: string, size: number): string {
  const marker = "/storage/v1/object/public/";
  if (!url.includes(marker)) return url;
  const px = Math.round(size * 2);
  const base = url.replace(marker, "/storage/v1/render/image/public/");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}width=${px}&height=${px}&resize=cover&quality=70`;
}

/** Faller tilbake til originalen hvis miniatyren ikke kan lages. */
export function onThumbError(original: string) {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.src !== original) img.src = original;
  };
}
