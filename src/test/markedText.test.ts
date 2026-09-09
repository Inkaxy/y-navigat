import { describe, expect, it } from "vitest";
import { splitMarkedText, stripMarkers, hasMarkers } from "@/varer/lib/markedText";

describe("splitMarkedText", () => {
  it("deler tekst med markører i fete og vanlige segmenter", () => {
    const segs = splitMarkedText("Hvetemel (*hvete*), vann, *melk*pulver");
    expect(segs).toEqual([
      { text: "Hvetemel (", bold: false },
      { text: "hvete", bold: true },
      { text: "), vann, ", bold: false },
      { text: "melk", bold: true },
      { text: "pulver", bold: false },
    ]);
  });

  it("gir ingen segmenter uten fete deler dersom hele feltet ikke er markert", () => {
    const segs = splitMarkedText("Vann, salt, gjær");
    expect(segs).toEqual([{ text: "Vann, salt, gjær", bold: false }]);
    // Aldri skal HELE feltet bli ett fett segment når det ikke er markert.
    expect(segs.some((s) => s.bold)).toBe(false);
  });

  it("returnerer tom liste for tom/manglende tekst", () => {
    expect(splitMarkedText(null)).toEqual([]);
    expect(splitMarkedText(undefined)).toEqual([]);
    expect(splitMarkedText("")).toEqual([]);
  });

  it("stripMarkers fjerner stjernene uten å endre teksten ellers", () => {
    expect(stripMarkers("Hvetemel (*hvete*), vann")).toBe("Hvetemel (hvete), vann");
  });

  it("hasMarkers oppdager om feltet har uthevede deler", () => {
    expect(hasMarkers("Hvetemel (*hvete*)")).toBe(true);
    expect(hasMarkers("Vann, salt")).toBe(false);
  });
});
