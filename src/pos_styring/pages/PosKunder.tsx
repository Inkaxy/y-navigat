import { CrudPageScaffold } from "@/pos_styring/components/CrudPageScaffold";

export default function PosKunder() {
  return (
    <CrudPageScaffold
      title="POS-kunder"
      description="Kunder som kan handle på regning i kassa."
      primaryAction="Ny POS-kunde"
    />
  );
}
