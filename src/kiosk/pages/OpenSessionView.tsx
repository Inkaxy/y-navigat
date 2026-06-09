import { useState } from "react";
import { toast } from "sonner";
import { KioskHeader } from "@/kiosk/components/KioskHeader";
import { BigButton } from "@/kiosk/components/BigButton";
import { useSession } from "@/kiosk/context/SessionContext";

export default function OpenSessionView() {
  const { openSession } = useSession();
  const [value, setValue] = useState("0");
  const [busy, setBusy] = useState(false);

  const handleOpen = async () => {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Ugyldig vekselbeholdning.");
      return;
    }
    setBusy(true);
    const res = await openSession(n);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Kunne ikke åpne sesjon.");
    } else {
      toast.success("Sesjon åpnet.");
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0F0E0E] text-[#F4ECDC]">
      <KioskHeader />
      <main className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.22em] text-amber-400/80">
              Åpne skift
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Vekselbeholdning
            </h1>
            <p className="mt-2 text-sm text-[#F4ECDC]/60">
              Tell opp kontanter i kassen og legg inn beløpet.
            </p>
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#F4ECDC]/70">
              Beløp (kr)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-3xl font-semibold tracking-tight text-[#F4ECDC] focus:border-amber-500 focus:outline-none"
            />
          </div>
          <BigButton onClick={handleOpen} disabled={busy} className="w-full">
            {busy ? "Åpner…" : "Åpne skift"}
          </BigButton>
        </div>
      </main>
    </div>
  );
}
