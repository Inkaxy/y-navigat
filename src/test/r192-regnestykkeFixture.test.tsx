// @vitest-environment jsdom
/** Demosiden /forhandsvisning/regnestykke: faktisk detalj, syntetiske data, ingen nettverk eller skrivekontroller. */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, act } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: rpc } }));
import RegnestykkePreviewContent from "@/dev/RegnestykkePreviewContent";

describe("regnestykke-demo", () => {
  it("kilden importerer ikke Supabase eller serverhooks", () => {
    const src = readFileSync("src/dev/RegnestykkePreviewContent.tsx", "utf8");
    expect(src).not.toMatch(/supabase|useSingleRecalcPreview\(|useQuery|rpc\(/);
    expect(readFileSync("src/App.tsx", "utf8")).toContain('path="/forhandsvisning/regnestykke"');
  });
  it("åpner faktisk detalj med alle eksempler, uten kall og uten skrivekontroller; Escape gir fokus tilbake", async () => {
    render(<RegnestykkePreviewContent />);
    expect(screen.getByText("Demonstrasjon – syntetiske data")).toBeTruthy();
    const b = screen.getByRole("button", { name: "Åpne regnestykket" });
    b.focus();
    await act(async () => { fireEvent.click(b); });
    expect(screen.getAllByText(/Mengde: 2 × 20 ≈ 40 kg/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Mengde: −2 × 20 ≈ −40 kg/)).toBeTruthy();
    expect(screen.getByText(/konverterer 1[\s ]000 g direkte til 1 kg/)).toBeTruthy();
    expect(screen.getByText(/Ført\/låst – beholdes/)).toBeTruthy();
    expect(screen.getByText(/avrundet mengde er for liten/)).toBeTruthy();
    expect(screen.getAllByText(/Ingen beregnet enhetspris/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Lagre|Kjør|Reberegn|Angre/ })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); });
    expect(document.activeElement).toBe(b);
  });
});
