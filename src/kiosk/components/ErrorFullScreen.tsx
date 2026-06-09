import { AlertTriangle } from "lucide-react";

interface Props {
  title: string;
  message?: string;
  details?: string;
}

export function ErrorFullScreen({ title, message, details }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F0E0E] text-[#F4ECDC] p-8">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15 text-red-400">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {message && <p className="text-base opacity-80">{message}</p>}
        {details && (
          <pre className="mt-4 whitespace-pre-wrap rounded-md bg-white/5 p-3 text-left text-xs opacity-60">
            {details}
          </pre>
        )}
      </div>
    </div>
  );
}
