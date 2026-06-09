import { KioskHeader } from "@/kiosk/components/KioskHeader";
import { BigButton } from "@/kiosk/components/BigButton";
import { useOperator } from "@/kiosk/context/OperatorContext";

export default function OperatorHome() {
  const { operator } = useOperator();
  return (
    <div className="flex min-h-screen flex-col bg-[#0F0E0E] text-[#F4ECDC]">
      <KioskHeader />
      <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.22em] text-amber-400/80">Velkommen</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            {operator?.display_name}
          </h1>
        </div>

        <BigButton
          disabled
          title="Bygges i K.1"
          className="cursor-not-allowed opacity-60"
        >
          Start salg
        </BigButton>
        <p className="max-w-md text-center text-sm text-[#F4ECDC]/50">
          Salgsflyten (keypad, kurv, betaling, kvittering) bygges i K.1.
          Sesjons-håndtering kommer i K.2/F2-DB.3.
        </p>
      </main>
      <footer className="border-t border-white/5 px-6 py-3 text-center text-xs text-[#F4ECDC]/40">
        Sesjon: ikke åpnet
      </footer>
    </div>
  );
}
