// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from "vitest";
import * as fabric from "fabric";
import { configureFabricLegacyOrigins } from "@/ordre/lib/fabricDefaults";

/**
 * Fabric 7 gjør «center» til standard origin. Kakedesign lagret med Fabric 6
 * forutsetter «left/top». Disse testene låser den gamle semantikken fast, slik
 * at et trykk ikke flytter seg etter oppgraderingen.
 */
describe("Fabric-origin etter oppgradering til 7", () => {
  beforeAll(() => {
    configureFabricLegacyOrigins();
  });

  it("bruker left/top som standard for objekter uten eksplisitt origin", () => {
    const rect = new fabric.Rect({ width: 100, height: 50, left: 0, top: 0, strokeWidth: 0 });
    expect(rect.originX).toBe("left");
    expect(rect.originY).toBe("top");
    const box = rect.getBoundingRect();
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(box.width).toBe(100);
    expect(box.height).toBe(50);
  });

  it("plasserer den rektangulære klippemasken fra øvre venstre hjørne", () => {
    const clip = new fabric.Rect({
      width: 300,
      height: 200,
      left: 0,
      top: 0,
      strokeWidth: 0,
      absolutePositioned: true,
    });
    const box = clip.getBoundingRect();
    expect([box.left, box.top, box.width, box.height]).toEqual([0, 0, 300, 200]);
  });

  it("beholder sentrert origin der koden setter det eksplisitt", () => {
    const circle = new fabric.Circle({
      radius: 50,
      originX: "center",
      originY: "center",
      left: 150,
      top: 100,
      strokeWidth: 0,
    });
    const box = circle.getBoundingRect();
    expect(box.left).toBe(100);
    expect(box.top).toBe(50);
  });

  it("gjenskaper posisjonen til gammel lagret data uten origin-felt", async () => {
    const legacy = {
      type: "Rect",
      left: 40,
      top: 25,
      width: 120,
      height: 60,
      scaleX: 1,
      scaleY: 1,
      strokeWidth: 0,
    };
    const restored = await fabric.Rect.fromObject(legacy);
    expect(restored.originX).toBe("left");
    expect(restored.originY).toBe("top");
    const box = restored.getBoundingRect();
    expect(box.left).toBe(40);
    expect(box.top).toBe(25);
  });

  it("beholder sentrert posisjon for lagret data som har origin-felt", async () => {
    const saved = {
      type: "Rect",
      left: 100,
      top: 100,
      width: 80,
      height: 40,
      originX: "center" as const,
      originY: "center" as const,
      strokeWidth: 0,
    };
    const restored = await fabric.Rect.fromObject(saved);
    const box = restored.getBoundingRect();
    expect(box.left).toBe(60);
    expect(box.top).toBe(80);
  });

  it("serialiserer origin slik Fabric 6 gjorde (eksplisitt kun når sentrert)", () => {
    const plain = new fabric.Rect({ width: 10, height: 10, left: 1, top: 2 }).toObject();
    expect(plain.originX).toBeUndefined();
    const centered = new fabric.Rect({
      width: 10,
      height: 10,
      left: 1,
      top: 2,
      originX: "center",
      originY: "center",
    }).toObject();
    expect(centered.originX).toBe("center");
    expect(centered.originY).toBe("center");
  });

  it("plasserer ny tekst sentrert der editoren ber om det", () => {
    const text = new fabric.Textbox("Gratulerer", {
      left: 200,
      top: 120,
      width: 100,
      originX: "center",
      originY: "center",
    });
    expect(text.originX).toBe("center");
    const box = text.getBoundingRect();
    expect(Math.round(box.left + box.width / 2)).toBe(200);
  });
});
