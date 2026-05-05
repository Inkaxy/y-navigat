import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { AppColorProvider } from "@/providers/AppColorProvider";

interface Props {
  title?: string;
  children: ReactNode;
}

export default function AdminLayout({ title, children }: Props) {
  const { pathname } = useLocation();
  const isIndex = pathname === "/admin" || pathname === "/admin/";

  return (
    <AppColorProvider appCode="nbos">
      <div className="space-y-6">
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link to="/hjem" className="inline-flex items-center gap-1 hover:text-foreground">
            <Home className="h-3.5 w-3.5" /> Hjem
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          {isIndex ? (
            <span className="text-foreground">Admin</span>
          ) : (
            <>
              <Link to="/admin" className="hover:text-foreground">Admin</Link>
              {title && (
                <>
                  <ChevronRight className="h-3.5 w-3.5" />
                  <span className="text-foreground">{title}</span>
                </>
              )}
            </>
          )}
        </nav>
        {children}
      </div>
    </AppColorProvider>
  );
}
