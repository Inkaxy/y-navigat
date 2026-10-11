import { createRoot } from "react-dom/client";
import PdfImportPreviewContent from "./PdfImportPreviewContent";
import "@/index.css";

/** Lokal HTML-inngang (bare dev-server). Publisert app bruker ruten /forhandsvisning/pdf-import. */
createRoot(document.getElementById("root")!).render(<PdfImportPreviewContent />);
