import { splitMarkedText } from "@/varer/lib/markedText";

/**
 * Viser ingredienstekst der allergener er merket med *stjerner* som fet skrift
 * per ord — aldri hele feltet.
 */
export function MarkedText({ text }: { text: string | null | undefined }) {
  const segments = splitMarkedText(text);
  if (!segments.length) return null;
  return (
    <>
      {segments.map((s, i) =>
        s.bold ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}
