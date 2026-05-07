import * as React from "react";
import { Document } from "@react-pdf/renderer";
import { PakkseddelPDFPage } from "./PakkseddelPDFDocument";
import { SkillearkPDFPage } from "./SkillearkPDFPage";
import type { BulkPakksedlerPDFData } from "@/ordre/hooks/useBulkPakksedlerPDF";

interface Props {
  data: BulkPakksedlerPDFData;
}

/**
 * Bulk-PDF: skilleark + pakksedler per tur.
 *
 * VIKTIG: @react-pdf/renderer aksepterer kun <Page>-elementer som direkte barn
 * av <Document>. <Fragment> krasjer internt under pdf().toBlob() uten
 * synlig feilmelding. Vi flatpakker derfor alle sider til en flat array.
 */
export function BulkPakksedlerPDFDocument({ data }: Props) {
  const pages: React.ReactElement[] = [];
  for (const group of data.groups) {
    pages.push(
      <SkillearkPDFPage
        key={`skille-${group.tour_id ?? "__null__"}`}
        tourLabel={group.tour_display_name}
        deliveryDate={data.delivery_date}
        noteCount={group.notes.length}
      />,
    );
    for (const note of group.notes) {
      pages.push(<PakkseddelPDFPage key={`note-${note.id}`} data={note} />);
    }
  }

  return (
    <Document
      title={`Pakksedler ${data.delivery_date} ${data.scope_label}`}
      author={data.legal_entity.legal_name}
    >
      {pages}
    </Document>
  );
}
