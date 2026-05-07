import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function M365Callback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");
    const errorDesc = params.get("error_description");

    if (oauthError) {
      navigate(`/ordre/innstillinger?error=${encodeURIComponent(errorDesc || oauthError)}`, { replace: true });
      return;
    }
    if (!code || !state) {
      navigate(`/ordre/innstillinger?error=${encodeURIComponent("Mangler code eller state fra Microsoft")}`, { replace: true });
      return;
    }

    const stored = sessionStorage.getItem("m365_oauth_state");
    if (!stored || stored !== state) {
      navigate(`/ordre/innstillinger?error=${encodeURIComponent("State-validering feilet (CSRF-beskyttelse)")}`, { replace: true });
      return;
    }

    (async () => {
      const { data, error } = await supabase.functions.invoke("microsoft-oauth-callback", {
        body: { code, state },
      });
      sessionStorage.removeItem("m365_oauth_state");
      if (error || !data?.success) {
        const msg = error?.message ?? data?.error ?? "Ukjent feil";
        navigate(`/ordre/innstillinger?error=${encodeURIComponent(msg)}`, { replace: true });
        return;
      }
      navigate(`/ordre/innstillinger?connected=true`, { replace: true });
    })();
  }, [params, navigate]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <div>Fullfører Microsoft 365-tilkobling …</div>
    </div>
  );
}
