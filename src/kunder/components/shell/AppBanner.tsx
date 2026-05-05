import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useKunderApp } from "@/kunder/hooks/useApp";

interface Props {
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
}

/** NBhub-tilpasset AppBanner-shim (matcher API fra Kunder-prosjektet). */
export function AppBanner({ title, subtitle, icon: Icon, actions }: Props) {
  const { data: app } = useKunderApp();
  const color = "#8b5cf6";
  return (
    <div
      className="border-b border-line"
      style={{
        background: `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
        color: "#fff",
      }}
    >
      <div className="container flex items-center gap-4 py-5">
        {Icon && <Icon className="h-7 w-7 shrink-0 opacity-90" />}
        <div className="flex-1">
          {title && <h1 className="text-xl font-semibold">{title ?? app?.display_name}</h1>}
          {subtitle && <p className="text-sm opacity-85">{subtitle}</p>}
        </div>
        {actions && <div>{actions}</div>}
      </div>
    </div>
  );
}
