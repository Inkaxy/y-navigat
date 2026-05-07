import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

export interface EmailAccountSetting {
  provider?: "microsoft365";
  email_address?: string;
  display_name?: string;
  tenant_id?: string;
  is_connected?: boolean;
  connected_at?: string;
}

export function useOrdreEmailSettings() {
  const [account, setAccount] = useState<EmailAccountSetting | null>(null);
  const [signature, setSignature] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("platform_settings")
      .select("key, value")
      .eq("category", "ordre_email")
      .in("key", ["email_account", "email_signature"]);
    if (error) {
      toast({ title: "Kunne ikke laste innstillinger", description: error.message, variant: "destructive" });
    } else {
      const acct = data?.find((r) => r.key === "email_account");
      const sig = data?.find((r) => r.key === "email_signature");
      setAccount((acct?.value as EmailAccountSetting | null) ?? null);
      setSignature(((sig?.value as { html?: string } | null)?.html) ?? "");
    }
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, []);

  const saveSignature = async (html: string) => {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("platform_settings")
      .upsert({
        category: "ordre_email",
        key: "email_signature",
        value: { html },
        updated_by: u.user?.id,
      }, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast({ title: "Lagring feilet", description: error.message, variant: "destructive" });
      return false;
    }
    setSignature(html);
    toast({ title: "Signatur lagret" });
    return true;
  };

  const startMicrosoftOAuth = async () => {
    const { data, error } = await supabase.functions.invoke("microsoft-oauth-init");
    if (error || !data?.authorization_url) {
      toast({
        title: "Kunne ikke starte tilkobling",
        description: error?.message ?? data?.error ?? "Ukjent feil",
        variant: "destructive",
      });
      return;
    }
    sessionStorage.setItem("m365_oauth_state", data.state);
    window.location.href = data.authorization_url;
  };

  const completeMicrosoftOAuth = async (code: string, state: string) => {
    const { data, error } = await supabase.functions.invoke("microsoft-oauth-callback", {
      body: { code, state },
    });
    if (error || !data?.success) {
      toast({
        title: "Tilkobling feilet",
        description: error?.message ?? data?.error ?? "Ukjent feil",
        variant: "destructive",
      });
      return false;
    }
    toast({ title: "Microsoft-konto koblet til", description: data.account_email });
    await reload();
    return true;
  };

  const disconnectMicrosoft = async () => {
    const { error, data } = await supabase.functions.invoke("microsoft-oauth-disconnect");
    if (error || !data?.success) {
      toast({
        title: "Frakobling feilet",
        description: error?.message ?? data?.error ?? "Ukjent feil",
        variant: "destructive",
      });
      return false;
    }
    toast({ title: "Microsoft-konto frakoblet" });
    await reload();
    return true;
  };

  return {
    account, signature, loading, saving,
    saveSignature, startMicrosoftOAuth, completeMicrosoftOAuth, disconnectMicrosoft,
    reload,
  };
}
