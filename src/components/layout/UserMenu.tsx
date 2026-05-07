import { useNavigate } from "react-router-dom";
import { ChevronDown, Check, LogOut, Sun, Moon, Monitor, User, Bell, HelpCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTheme, type ThemeMode } from "@/providers/ThemeProvider";

export function UserMenu() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();
  const { data: profile } = useCurrentUser();

  const displayName = profile?.display_name ?? profile?.email ?? "Bruker";

  const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light",  label: "Lyst",   icon: Sun },
    { value: "dark",   label: "Mørkt",  icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-1.5 rounded-full border border-brand-cream/15 bg-brand-cream/[0.04] px-3 py-1.5 text-brand-cream/85 transition-all hover:bg-brand-cream/[0.08] hover:border-brand-bronze/40 hover:text-brand-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bronze/50"
        style={{ fontFamily: "Inter, sans-serif", fontSize: "13px", fontWeight: 500 }}
      >
        <span className="max-w-[160px] truncate">{displayName}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => navigate("/min-profil")} className="flex items-center gap-2">
          <User className="h-4 w-4 opacity-70" /> Min profil
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/varsler")} className="flex items-center gap-2">
          <Bell className="h-4 w-4 opacity-70" /> Varsler
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/hjelp")} className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 opacity-70" /> Hjelp
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Tema</DropdownMenuLabel>
        {themeOptions.map((opt) => {
          const Icon = opt.icon;
          return (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => setMode(opt.value)}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4 opacity-70" />
                {opt.label}
              </span>
              {mode === opt.value && <Check className="h-4 w-4 text-app" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await signOut();
            navigate("/login", { replace: true });
          }}
          className="flex items-center gap-2 text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          Logg ut
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
