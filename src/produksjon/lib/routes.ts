export const PRODUKSJON_BASE = "/produksjon";

export const produksjonRoutes = {
  oversikt: `${PRODUKSJON_BASE}/oversikt`,
  produksjonsplan: `${PRODUKSJON_BASE}/produksjonsplan`,
  etiketter: `${PRODUKSJON_BASE}/etiketter`,
  innstillinger: {
    produksjonsavdelinger: `${PRODUKSJON_BASE}/innstillinger/produksjonsavdelinger`,
    pakkeomrader: `${PRODUKSJON_BASE}/innstillinger/pakkeomrader`,
    utskriftsprofiler: `${PRODUKSJON_BASE}/innstillinger/utskriftsprofiler`,
  },
} as const;
