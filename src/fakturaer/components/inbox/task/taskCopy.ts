import type { LineStatus } from "@/fakturaer/lib/lineStatus";

export type TaskMode = "material" | "package" | "price" | "conflict" | "done";

const MODE: Record<LineStatus["key"], TaskMode> = {
  conflict: "conflict",
  choose_material: "material",
  confirm_material: "material",
  confirm_package: "package",
  recalculate: "price",
  review_price: "price",
  start_price: "price",
  check_line: "price",
  ready: "done",
  not_applicable: "done",
};

const COPY: Record<LineStatus["key"], { missing: string; primary: string }> = {
  conflict: { missing: "Varenummeret peker på flere råvarer. Velg hvilken som gjelder.", primary: "Løs konflikt" },
  choose_material: { missing: "Velg hvilken råvare denne linjen er.", primary: "Bekreft råvare og fortsett" },
  confirm_material: { missing: "Råvaren er bare foreslått. Bekreft eller velg en annen.", primary: "Bekreft råvare og fortsett" },
  confirm_package: { missing: "Råvaren er kjent, men pakningen må bekreftes før mengden kan regnes om.", primary: "Bekreft pakning og fortsett" },
  recalculate: { missing: "Linjen er endret, men prisen er ikke regnet om ennå.", primary: "Beregn prisen på nytt" },
  review_price: { missing: "Prisen avviker. Er den riktig, godta den.", primary: "Prisen er riktig" },
  start_price: { missing: "Første bekreftede kjøpspris kan lagres som startpris.", primary: "Bekreft startpris" },
  check_line: { missing: "Linjen står til kontroll uten en årsak vi kjenner igjen. Kontroller den mot originalfakturaen.", primary: "Gå til neste linje" },
  ready: { missing: "Linjen er avklart.", primary: "Gå til neste linje" },
  not_applicable: { missing: "Linjen er utelatt som ikke råvare.", primary: "Gå til neste linje" },
};

export const taskCopy = {
  modeFor: (key: LineStatus["key"]): TaskMode => MODE[key],
  forStatus: (key: LineStatus["key"]) => COPY[key],
};
