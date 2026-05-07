import { useEffect, useState } from "react";

interface Props {
  startedAt: string | null | undefined;
  endedAt?: string | null;
}

export function LiveTimer({ startedAt, endedAt }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endedAt]);
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : now;
  const diff = Math.max(0, end - start);
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return (
    <span className="tabular-nums">
      {m}m {s.toString().padStart(2, "0")}s
    </span>
  );
}
