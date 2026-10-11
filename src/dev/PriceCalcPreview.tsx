import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import PriceCalcPreviewContent from "./PriceCalcPreviewContent";
import "@/index.css";

/** Lokal HTML-inngang (bare dev-server). Publisert app bruker ruten /forhandsvisning/pris. */
createRoot(document.getElementById("root")!).render(<MemoryRouter><PriceCalcPreviewContent /></MemoryRouter>);
