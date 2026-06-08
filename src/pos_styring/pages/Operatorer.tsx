import { CrudPageScaffold } from "@/pos_styring/components/CrudPageScaffold";

export default function Operatorer() {
  return (
    <CrudPageScaffold
      title="Operatører"
      description="Kasse-operatører med PIN-kode og terminaltilknytning."
      primaryAction="Ny operatør"
    />
  );
}
