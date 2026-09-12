/** @vitest-environment jsdom */
import { describe, expect, it, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { createRichTextExtensions } from "@/ordre/lib/richTextExtensions";

/**
 * Ekte rundtur gjennom editoren som e-postsvar faktisk bruker — ikke bare
 * hjelpefunksjonen for lenker.
 */
let editor: Editor | null = null;

function makeEditor(content: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: createRichTextExtensions(), content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

describe("riktekst-editoren – rundtur med ekte oppsett", () => {
  const HTML =
    "<h2>Bestilling av grovbrød</h2>" +
    "<p>Hei, <strong>takk</strong> for <em>bestillingen</em> – vi leverer på tirsdag.</p>" +
    "<ul><li>Grovbrød à 750 g</li><li>Rundstykker</li></ul>" +
    '<p>Se <a href="https://nbhub.no/varer">varelisten</a>.</p>';

  it("bevarer norsk tekst, formatering og lenke gjennom getHTML", () => {
    const html = makeEditor(HTML).getHTML();
    expect(html).toContain("Bestilling av grovbrød");
    expect(html).toContain("<strong>takk</strong>");
    expect(html).toContain("<em>bestillingen</em>");
    expect(html).toContain("Grovbrød à 750 g");
    expect(html).toContain("–"); // tankestrek overlever
    expect(html).toContain('href="https://nbhub.no/varer"');
    expect(html).toContain("<h2>");
    expect(html).toContain("<ul>");
  });

  it("er stabil: å sette samme innhold tilbake gir identisk HTML og ingen løkke", () => {
    const ed = makeEditor(HTML);
    const first = ed.getHTML();
    let updates = 0;
    ed.on("update", () => {
      updates += 1;
    });

    ed.commands.setContent(first, { emitUpdate: false });
    const second = ed.getHTML();
    ed.commands.setContent(second, { emitUpdate: false });
    const third = ed.getHTML();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(updates).toBe(0);
  });

  it("avviser farlig href når lagret HTML lastes inn", () => {
    const html = makeEditor(
      '<p>Se <a href="javascript:alert(1)">her</a> og <a href="data:text/html,<script>x</script>">her</a>.</p>',
    ).getHTML();
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).toContain("Se");
    expect(html).toContain("her");
  });

  it("avviser farlig href ved innliming av HTML", () => {
    const ed = makeEditor("<p></p>");
    ed.commands.insertContent('<p>Lim: <a href="vbscript:msgbox(1)">klikk</a></p>');
    const html = ed.getHTML();
    expect(html).not.toContain("vbscript:");
    expect(html).toContain("klikk");
  });

  it("beholder trygg lenke ved innliming", () => {
    const ed = makeEditor("<p></p>");
    ed.commands.insertContent('<p><a href="mailto:post@nbhub.no">skriv til oss</a></p>');
    expect(ed.getHTML()).toContain('href="mailto:post@nbhub.no"');
  });
});
