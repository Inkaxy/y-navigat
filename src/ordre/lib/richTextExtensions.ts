import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import type { Extensions } from "@tiptap/core";
import { sanitizeEditorHref } from "@/ordre/lib/linkSanitize";

/**
 * Editoroppsettet for riktekst (e-postsvar).
 *
 * Ligger i egen fil slik at testene kan instansiere NØYAKTIG samme oppsett som
 * skjermbildet bruker — en test av hjelpefunksjonen alene fanger ikke opp at en
 * farlig `href` slipper gjennom når HTML lastes inn eller limes inn.
 */
export function createRichTextExtensions(placeholder?: string): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, underline: false }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: { class: "text-primary underline" },
      // Gjelder både innlasting av lagret HTML, innliming og autolenking.
      isAllowedUri: (url) => sanitizeEditorHref(url) !== null,
      shouldAutoLink: (url) => sanitizeEditorHref(url) !== null,
    }),
    Placeholder.configure({ placeholder: placeholder ?? "Skriv innholdet i e-posten her…" }),
  ];
}
