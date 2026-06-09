import { useTerminal } from "@/kiosk/context/TerminalContext";
import { PinPad } from "@/kiosk/components/PinPad";

export default function OperatorLogin() {
  const { terminal } = useTerminal();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0F0E0E] p-6 text-[#F4ECDC]">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-xs uppercase tracking-[0.22em] text-amber-400/80">
            Nøtterø Bakeri · Kasse
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {terminal?.display_name ?? "Kasse"}
          </h1>
          <p className="mt-1 font-mono text-xs text-[#F4ECDC]/50">
            {terminal?.terminal_code}
          </p>
        </div>
        <PinPad />
      </div>
    </div>
  );
}
