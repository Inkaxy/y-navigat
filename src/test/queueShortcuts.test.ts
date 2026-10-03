// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleQueueShortcut, type QueueShortcutContext } from "@/fakturaer/lib/queueShortcuts";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a) } }));

const line = { id: "l1", raw_material_id: null } as unknown as ReviewLineRow;

function ctx(over: Partial<QueueShortcutContext> = {}): QueueShortcutContext {
  return {
    queueVisible: true, dialogOpen: false, activeLine: line,
    canAcceptWithEnter: () => true,
    next: vi.fn(), prev: vi.fn(), accept: vi.fn(), openDialog: vi.fn(), undo: vi.fn(),
    ...over,
  };
}
const key = (k: string) => new KeyboardEvent("keydown", { key: k, cancelable: true });

describe("køens hurtigtaster", () => {
  it("skjult kø: Enter lagrer ikke, m/n/x åpner ingen dialog, piler scroller vanlig", () => {
    const c = ctx({ queueVisible: false });
    for (const k of ["Enter", "m", "n", "x"]) handleQueueShortcut(key(k), c);
    const down = key("ArrowDown");
    handleQueueShortcut(down, c);
    expect(c.accept).not.toHaveBeenCalled();
    expect(c.openDialog).not.toHaveBeenCalled();
    expect(c.next).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(false);
  });

  it("synlig kø: snarveiene virker", () => {
    const c = ctx();
    handleQueueShortcut(key("Enter"), c);
    handleQueueShortcut(key("m"), c);
    const down = key("ArrowDown");
    handleQueueShortcut(down, c);
    expect(c.accept).toHaveBeenCalledWith(line);
    expect(c.openDialog).toHaveBeenCalledWith("match", line);
    expect(c.next).toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(true);
  });

  it("åpen dialog blokkerer fortsatt", () => {
    const c = ctx({ dialogOpen: true });
    handleQueueShortcut(key("Enter"), c);
    expect(c.accept).not.toHaveBeenCalled();
  });
});

describe("enkeltgodkjenning", () => {
  beforeEach(() => toastSuccess.mockReset());
  it("åpner ikke massekobling automatisk, men tilbyr «Bruk på flere»", async () => {
    const { notifyAccepted } = await import("@/fakturaer/lib/acceptNotice");
    const openBulk = vi.fn();
    notifyAccepted("Hvetemel", "rms-1", openBulk);
    expect(openBulk).not.toHaveBeenCalled();
    const opts = toastSuccess.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("Bruk på flere");
    opts.action.onClick();
    expect(openBulk).toHaveBeenCalledWith("rms-1", "Hvetemel");
  });
});
