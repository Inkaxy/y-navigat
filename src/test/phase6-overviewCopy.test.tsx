// @vitest-environment jsdom
/** Oversikten: blandet hendelsesliste, norske prosenter med fortegn, og databladendringer som rent antall. */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityView } from "@/ravarer/pages/oversikt/ActivityView";
import { PriceMoversView } from "@/ravarer/pages/oversikt/PriceMoversView";
import { DataQualityView } from "@/ravarer/pages/oversikt/DataQualityView";
import type { ActivityFeed, PriceMover } from "@/ravarer/lib/workRpcTypes";

const wrap = (n: JSX.Element) => render(<MemoryRouter>{n}</MemoryRouter>);

describe("ActivityView", () => {
  it("overskriften påstår ikke automatikk; manuell rad med navn vises", () => {
    const data = { items: [{ id: "1", kind: "pris_godtatt", at: new Date().toISOString(), actor: "user", user_name: "Henrik Næss", invoice_id: null, raw_material_id: null }], summary: {} } as unknown as ActivityFeed;
    wrap(<ActivityView data={data} />);
    expect(screen.getByRole("heading", { name: "Siste hendelser" })).toBeTruthy();
    expect(screen.queryByText(/Skjedde automatisk/)).toBeNull();
    expect(screen.getByText("Ingen hendelser i disse kategoriene siste 7 dager.")).toBeTruthy();
  });
  it("oppsummeringen er merket som utvalgte hendelser", () => {
    wrap(<ActivityView data={{ items: [], summary: { faktura_avstemt_auto: 2 } } as unknown as ActivityFeed} />);
    expect(screen.getByText(/^Utvalgte hendelser siste 7 dager: 2 fakturaer avstemt automatisk/)).toBeTruthy();
  });
});

const mover = (id: string, change_pct: number | null): PriceMover => ({
  raw_material_id: id, rm_name: `Vare ${id}`, base_unit: "kg", supplier_id: null, supplier_name: null, before_price: 10, before_date: "2026-09-01",
  now_price: 11, now_date: "2026-10-01", change_pct, quantity: null, effect_nok: null, suspicious: false, points: [],
});

describe("PriceMoversView", () => {
  it("norsk format med fortegn; ukjent/ikke-endelig er —; små endringer beholder fortegn", () => {
    const items = [mover("a", 74.3), mover("b", -74.3), mover("c", 0), mover("d", null), mover("e", Number.NaN), mover("f", 0.01), mover("g", -0.01)];
    wrap(<PriceMoversView data={{ days: 30, from: null, items, summary: { changed: 7, up: 2, down: 2, suspicious: 0, effect_nok: 0, effect_up_nok: 0, effect_down_nok: 0 }, generated_at: null }} period={30} onPeriodChange={() => undefined} />);
    const t = document.body.textContent ?? "";
    expect(t).toContain("+74,3 %");
    expect(t).toContain("−74,3 %");
    expect(t).toContain("0,0 %");
    expect(t).toContain("+<0,1 %");
    expect(t).toContain("−<0,1 %");
    expect(t).not.toMatch(/74\.3|NaN/);
  });
});

describe("DataQualityView", () => {
  const dq = { missing_package: 0, unconfirmed_package: 0, unstable_price: 0, missing_declaration: 0, missing_nutrition: 0, datasheet_changes: 0, active_items: 391 };
  it("0 endringer gir ikke «391 av 391 datablad bekreftet»", () => {
    wrap(<DataQualityView dq={dq} supplier={null} stockBelowMin={0} />);
    expect(screen.queryByText(/Datablad bekreftet/)).toBeNull();
    expect(screen.getByText("Viser ventende endringer, ikke hvor mange varer som har datablad.")).toBeTruthy();
  });
  it("antall endringer med samme gjennomgangslenke", () => {
    wrap(<DataQualityView dq={{ ...dq, datasheet_changes: 4 }} supplier={null} stockBelowMin={0} />);
    const link = screen.getByRole("link", { name: "Databladendringer til gjennomgang" });
    expect(link.getAttribute("href")).toBe("/ravarer/varer?liste=datablad");
    expect(link.parentElement?.textContent).toContain("4");
  });
});
