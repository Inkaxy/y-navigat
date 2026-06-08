import { CrudPageScaffold } from "@/components/CrudPageScaffold";

export default function Operatorer() {
  return (
    <CrudPageScaffold
      title="Operatører"
      description="Kasse-operatører med PIN-kode og terminaltilknytning."
      primaryAction="Ny operatør"
    />
  );
}
