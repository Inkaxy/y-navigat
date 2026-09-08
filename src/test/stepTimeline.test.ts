import { describe, it, expect } from "vitest";
import { buildTimeline, totalMinutes } from "@/varer/components/recipes/StepTimeline";

describe("buildTimeline", () => {
  it("akkumulerer klokkeslett riktig for flere steg", () => {
    const rows = buildTimeline({
      startTime: "08:00",
      steps: [
        { id: "1", step_type: "mix", title: null, duration_minutes: 15 },
        { id: "2", step_type: "bulk", title: null, duration_minutes: 90 },
      ],
    });
    expect(rows[0].startsAt).toBe("08:00");
    expect(rows[0].endsAt).toBe("08:15");
    expect(rows[1].startsAt).toBe("08:15");
    expect(rows[1].endsAt).toBe("09:45");
  });

  it("legger hodefeltene først, kun når verdien er større enn 0", () => {
    const rows = buildTimeline({
      startTime: "08:00",
      steps: [{ id: "1", step_type: null, title: null, duration_minutes: 60 }],
      header: { autolyse_minutes: 30, mixing_speed1_minutes: 0, mixing_speed2_minutes: 10 },
    });
    expect(rows.map((r) => r.label)).toEqual(["Autolyse", "Elting 2. gir", "Steg"]);
    expect(rows[0].derived).toBe(true);
    expect(rows[2].derived).toBe(false);
  });

  it("ruller over midnatt", () => {
    const rows = buildTimeline({
      startTime: "23:30",
      steps: [{ id: "1", step_type: "proof", title: null, duration_minutes: 60 }],
    });
    expect(rows[0].startsAt).toBe("23:30");
    expect(rows[0].endsAt).toBe("00:30");
  });

  it("faller tilbake til 08:00 ved ugyldig starttid", () => {
    const rows = buildTimeline({
      startTime: "ikke-en-tid",
      steps: [{ id: "1", step_type: "bulk", title: null, duration_minutes: 10 }],
    });
    expect(rows[0].startsAt).toBe("08:00");
  });

  it("velger title før step_type, og faller tilbake til Steg", () => {
    const rows = buildTimeline({
      startTime: "08:00",
      steps: [
        { id: "1", step_type: "bulk", title: "Min egen tittel", duration_minutes: 10 },
        { id: "2", step_type: "bake", title: null, duration_minutes: 10 },
        { id: "3", step_type: null, title: null, duration_minutes: 10 },
      ],
    });
    expect(rows[0].label).toBe("Min egen tittel");
    expect(rows[1].label).toBe("Steking");
    expect(rows[2].label).toBe("Steg");
  });

  it("tillater 0 eller manglende varighet", () => {
    const rows = buildTimeline({
      startTime: "08:00",
      steps: [
        { id: "1", step_type: "rest", title: null, duration_minutes: 0 },
        { id: "2", step_type: "rest", title: null, duration_minutes: null },
      ],
    });
    expect(rows[0].minutes).toBe(0);
    expect(rows[1].minutes).toBe(0);
  });
});

describe("totalMinutes", () => {
  it("summerer varigheten for alle radene", () => {
    const rows = buildTimeline({
      startTime: "08:00",
      steps: [
        { id: "1", step_type: "mix", title: null, duration_minutes: 15 },
        { id: "2", step_type: "bulk", title: null, duration_minutes: 90 },
      ],
      header: { autolyse_minutes: 30 },
    });
    expect(totalMinutes(rows)).toBe(135);
  });
});
