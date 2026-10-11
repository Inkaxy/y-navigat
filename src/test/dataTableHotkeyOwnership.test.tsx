// @vitest-environment jsdom
/** Fokusert mobilkort: Enter gir ÉN handling (kortets egen), ikke i tillegg global «åpne». */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DataTable } from "@/ravarer/ui/DataTable";
import { shouldIgnoreShortcut } from "@/ravarer/ui/hotkeys";

type Row = { id: string; name: string };
const rows: Row[] = [{ id: "a", name: "Anis" }];

function setup() {
  const onActiveChange = vi.fn();
  const onEnter = vi.fn();
  render(
    <MemoryRouter><TooltipProvider><DataTable<Row>
      ariaLabel="t" rows={rows} getId={(r) => r.id} columns={[{ id: "name", header: "Navn", cell: (r) => r.name }]}
      activeId="a" onActiveChange={onActiveChange} onEnter={onEnter} hotkeys
      renderMobileCard={(r) => <span>{r.name} kort</span>}
    /></TooltipProvider></MemoryRouter>,
  );
  return { onActiveChange, onEnter };
}

describe("hurtigtast-eierskap", () => {
  it("Enter på fokusert mobilkort aktiverer én gang og kjører ikke global Enter", () => {
    const { onActiveChange, onEnter } = setup();
    const card = screen.getByText("Anis kort").closest('[role="button"]') as HTMLElement;
    card.focus();
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onActiveChange.mock.calls.length + onEnter.mock.calls.length).toBe(1);
  });
  it("global Enter utenfor interaktive elementer åpner fortsatt aktiv rad", () => {
    const { onEnter } = setup();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
  it("vakten: håndtert hendelse, rolle-knapp, native knapp og felt svelger Enter", () => {
    const mk = (el: HTMLElement, init: KeyboardEventInit = {}) => { const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }); Object.defineProperty(e, "target", { value: el }); return e; };
    const div = document.createElement("div");
    const pre = mk(div); pre.preventDefault();
    expect(shouldIgnoreShortcut(pre)).toBe(true);
    const rb = document.createElement("div"); rb.setAttribute("role", "button");
    expect(shouldIgnoreShortcut(mk(rb))).toBe(true);
    expect(shouldIgnoreShortcut(mk(document.createElement("button")))).toBe(true);
    expect(shouldIgnoreShortcut(mk(document.createElement("input")))).toBe(true);
    expect(shouldIgnoreShortcut(mk(div))).toBe(false);
    // J/K på et rollekort er fortsatt tillatt.
    expect(shouldIgnoreShortcut(mk(rb, { key: "j" }))).toBe(false);
  });
});
