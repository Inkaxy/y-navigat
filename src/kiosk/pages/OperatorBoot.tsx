interface Props {
  label?: string;
}

export default function OperatorBoot({ label = "Starter Kiosk…" }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F0E0E] text-[#F4ECDC]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-amber-400/30 border-t-amber-400" />
        <p className="text-sm uppercase tracking-[0.2em] text-[#F4ECDC]/60">{label}</p>
      </div>
    </div>
  );
}
