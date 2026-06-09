import { useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";
import { BigButton } from "./BigButton";
import { useOperator } from "@/kiosk/context/OperatorContext";

function haptic() {
  try {
    if ("vibrate" in navigator) navigator.vibrate?.(15);
  } catch {
    // ignore
  }
}

export function PinPad() {
  const { login } = useOperator();
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    codeInputRef.current?.focus();
  }, []);

  const press = (d: string) => {
    haptic();
    if (busy) return;
    if (pin.length >= 6) return;
    setPin((p) => p + d);
    setError(null);
  };

  const backspace = () => {
    haptic();
    if (busy) return;
    setPin((p) => p.slice(0, -1));
  };

  const submit = async () => {
    if (busy) return;
    if (!code.trim() || pin.length < 4) {
      setError("Skriv inn operatør-kode og 4–6-sifret PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await login(code, pin);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setPin("");
      return;
    }
    // Suksess → OperatorContext oppdaterer state, parent rerendrer.
  };

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-2">
        <label className="block text-xs uppercase tracking-[0.18em] text-[#F4ECDC]/60">
          Operatør-kode
        </label>
        <input
          ref={codeInputRef}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-2xl font-mono uppercase tracking-widest text-[#F4ECDC] focus:outline-none focus:ring-2 focus:ring-amber-400/40"
          maxLength={20}
          disabled={busy}
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs uppercase tracking-[0.18em] text-[#F4ECDC]/60">PIN</label>
        <div className="flex h-14 items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5">
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span
              key={i}
              className={`h-4 w-4 rounded-full transition-colors ${
                i < pin.length ? "bg-amber-400" : "bg-white/15"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <BigButton key={d} variant="secondary" onClick={() => press(d)}>
            {d}
          </BigButton>
        ))}
        <BigButton variant="ghost" onClick={backspace} aria-label="Slett siste siffer">
          <Delete className="mx-auto h-7 w-7" />
        </BigButton>
        <BigButton variant="secondary" onClick={() => press("0")}>
          0
        </BigButton>
        <BigButton
          variant="ghost"
          onClick={() => {
            haptic();
            setPin("");
          }}
        >
          Tøm
        </BigButton>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <BigButton onClick={submit} disabled={busy} className="w-full">
        {busy ? "Logger på…" : "Logg på"}
      </BigButton>
    </div>
  );
}
