import { describe, expect, it, vi } from "vitest";
import {
  MAIN_RUN_PAGE,
  findCompletedMainRun,
  type RunLike,
  type RunPageResult,
} from "@/produksjon/features/produksjonsplan/lib/planSource";

const run = (id: string, tourFilter: string[] | null): RunLike => ({
  id,
  completed_at: "2026-09-12T05:00:00Z",
  finished_at: null,
  tour_filter: tourFilter,
  notes_generated: 3,
});

/** Sidevis kilde som speiler `.range(from, to)` i Supabase. */
function pager(all: RunLike[]): (from: number, to: number) => Promise<RunPageResult> {
  return async (from, to) => ({ data: all.slice(from, to + 1), error: null });
}

describe("findCompletedMainRun", () => {
  const tourNumberById = new Map<string, number | null>([
    ["tour-1", 1],
    ["tour-9", 9],
  ]);

  it("finner riktig kjøring selv når mange nyere kjøringer har feil turfilter", async () => {
    // 60 nyere kjøringer dekker bare tur 9 — den riktige ligger på side 2.
    const all = [
      ...Array.from({ length: 60 }, (_, i) => run(`feil-${i}`, ["tour-9"])),
      run("riktig", ["tour-1"]),
    ];
    expect(all.length).toBeGreaterThan(MAIN_RUN_PAGE);

    const fetchPage = vi.fn(pager(all));
    const hit = await findCompletedMainRun(fetchPage, [1], tourNumberById);

    expect(hit?.id).toBe("riktig");
    expect(fetchPage.mock.calls.length).toBeGreaterThan(1);
  });

  it("gir «ingen kjøring» først når listen faktisk er slutt", async () => {
    const all = Array.from({ length: 12 }, (_, i) => run(`feil-${i}`, ["tour-9"]));
    const hit = await findCompletedMainRun(pager(all), [1], tourNumberById);
    expect(hit).toBeNull();
  });

  it("kaster ved spørringsfeil i stedet for å påstå at hovedkjøringen mangler", async () => {
    await expect(
      findCompletedMainRun(
        async () => ({ data: null, error: { message: "nettverksfeil" } }),
        [1],
        tourNumberById,
      ),
    ).rejects.toThrow("nettverksfeil");
  });

  it("kaster feil på side 2 også når side 1 var i orden", async () => {
    const first = Array.from({ length: MAIN_RUN_PAGE }, (_, i) => run(`feil-${i}`, ["tour-9"]));
    let call = 0;
    await expect(
      findCompletedMainRun(
        async (from, to) => {
          call += 1;
          if (call === 1) return { data: first.slice(from, to + 1), error: null };
          return { data: null, error: { message: "timeout" } };
        },
        [1],
        tourNumberById,
      ),
    ).rejects.toThrow("timeout");
  });
});
