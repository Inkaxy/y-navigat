import { useNavigate } from "react-router-dom";
import { ChevronDown, Check, LogOut, Sun, Moon, Monitor } from "lucide-react";
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
        className="flex items-center gap-1 rounded-md px-2 py-1 text-app-foreground/90 transition-colors hover:bg-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        style={{ fontFamily: "Inter, sans-serif", fontSize: "13px" }}
      >
        <span className="max-w-[160px] truncate">{displayName}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-80" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
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
