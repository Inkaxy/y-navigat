import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import LoginLogo from "@/assets/brand/logo-login.svg?react";

interface AuthShellProps {
  title: string;
  description: string;
  children: ReactNode;
  /** Valgfri fotnote under kortet (lenker, hjelpetekst). */
  footer?: ReactNode;
}

/**
 * Felles ramme for de offentlige auth-sidene (logg inn, glemt passord,
 * tilbakestill passord). Moderat, responsiv logo og et smalt kort som
 * fungerer like godt på mobil som på skjerm.
 */
export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center bg-surface-canvas px-4 py-8 safe-px"
      style={{
        background:
          "radial-gradient(ellipse at top, hsl(var(--surface-raised)) 0%, hsl(var(--surface-canvas)) 70%)",
      }}
    >
      <div className="w-full max-w-sm animate-fade-in space-y-6">
        <div className="flex flex-col items-center text-center">
          <LoginLogo
            role="img"
            aria-label="Nøtterø Bakeri"
            className="h-32 w-auto text-brand-ink sm:h-40 md:h-44"
          />
        </div>

        <Card className="shadow-elevated">
          <CardHeader className="space-y-1.5">
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>

        {footer ? <div className="space-y-1 text-center text-xs text-muted-foreground">{footer}</div> : null}
      </div>
    </main>
  );
}

export default AuthShell;
