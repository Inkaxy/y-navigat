import { LayoutDashboard } from "lucide-react";
import { useCompany } from "@/hooks/useCompany";
import { cn } from "@/lib/utils";

/**
 * CompanyBlock — venstre i topbar.
 * NBhub er ett firma: ingen selskapsvelger, kun visning av `display_name`.
 */
export function CompanyBlock({ className }: { className?: string }) {
  const { data: company } = useCompany();
  const label = (company?.display_name ?? "Nøtterø Bakeri").toUpperCase();
  const year = company?.founded_year ?? null;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 py-1.5 pl-1 pr-3.5 text-brand-cream",
        "border-r border-brand-cream/10",
        className,
      )}
    >
      <span
        className="font-display"
        style={{ fontWeight: 600, fontSize: "13px", letterSpacing: "0.04em" }}
      >
        {label}
        {year && (
          <sup
            className="font-display"
            style={{
              fontSize: "9px",
              fontWeight: 500,
              marginLeft: "3px",
              verticalAlign: "super",
              color: "hsl(var(--brand-bronze-soft))",
              opacity: 0.95,
            }}
          >
            {year}
          </sup>
        )}
      </span>
    </div>
  );
}

/** Re-eksport som ikon — kun for visuell bruk i BrandBlock. */
export const CompanyBlockIcon = LayoutDashboard;
