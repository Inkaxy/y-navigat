/**
 * Minimal erstatning for `https://deno.land/x/xml` i vitest.
 *
 * Gir samme form som biblioteket for den delen av UBL importen faktisk leser:
 * attributter som `@navn`, tekstinnhold som `#text` (eller rå streng når
 * elementet verken har attributter eller barn), og gjentatte elementer som
 * array. Den er bevisst enkel — den skal kjøre den EKTE importkoden mot en
 * kontrollert fixture, ikke være en fullverdig XML-parser.
 */

type Node = Record<string, unknown> | string;

interface Element {
  name: string;
  attrs: Record<string, string>;
  children: Element[];
  text: string;
}

function parseElement(src: string, start: number): { el: Element; next: number } {
  const open = src.indexOf("<", start);
  if (open < 0) throw new Error("Fant ikke element");
  const close = src.indexOf(">", open);
  if (close < 0) throw new Error("Uavsluttet tagg");
  const rawTag = src.slice(open + 1, close);
  const selfClosing = rawTag.endsWith("/");
  const tag = selfClosing ? rawTag.slice(0, -1) : rawTag;
  const nameMatch = /^([^\s/>]+)/.exec(tag);
  if (!nameMatch) throw new Error("Ugyldig tagg");
  const name = nameMatch[1];

  const attrs: Record<string, string> = {};
  const attrRe = /([^\s=]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  const attrSrc = tag.slice(name.length);
  while ((m = attrRe.exec(attrSrc)) !== null) attrs[m[1]] = m[2];

  const el: Element = { name, attrs, children: [], text: "" };
  if (selfClosing) return { el, next: close + 1 };

  let i = close + 1;
  for (;;) {
    const nextOpen = src.indexOf("<", i);
    if (nextOpen < 0) throw new Error(`Uavsluttet element ${name}`);
    el.text += src.slice(i, nextOpen);
    if (src.startsWith(`</`, nextOpen)) {
      const endClose = src.indexOf(">", nextOpen);
      return { el, next: endClose + 1 };
    }
    const child = parseElement(src, nextOpen);
    el.children.push(child.el);
    i = child.next;
  }
}

function toNode(el: Element): Node {
  const text = el.text.trim();
  if (el.children.length === 0 && Object.keys(el.attrs).length === 0) return text;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el.attrs)) out[`@${k}`] = v;
  if (text) out["#text"] = text;
  for (const child of el.children) {
    const value = toNode(child);
    if (child.name in out) {
      const prev = out[child.name];
      out[child.name] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else {
      out[child.name] = value;
    }
  }
  return out;
}

export function parse(xml: string): Record<string, unknown> {
  const cleaned = xml
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const { el } = parseElement(cleaned, 0);
  return { [el.name]: toNode(el) };
}
