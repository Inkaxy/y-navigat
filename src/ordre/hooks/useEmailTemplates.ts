import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

export interface EmailTemplate {
  id: string;
  template_key: string;
  display_name: string;
  subject_template: string;
  body_html_template: string;
  body_text_template: string | null;
  available_variables: Array<{ key: string; description: string; example?: string }>;
  is_active: boolean;
  updated_at: string;
}

export function useEmailTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("email_templates")
      .select("*")
      .order("display_name");
    if (error) {
      toast({ title: "Kunne ikke laste maler", description: error.message, variant: "destructive" });
    } else {
      setTemplates((data ?? []) as unknown as EmailTemplate[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, []);

  const saveTemplate = async (id: string, patch: Partial<Pick<EmailTemplate, "subject_template" | "body_html_template" | "body_text_template" | "is_active">>) => {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const normalized: typeof patch & { updated_by?: string } = { ...patch, updated_by: u.user?.id };
    if ("body_text_template" in normalized) {
      const v = normalized.body_text_template;
      if (typeof v === "string" && v.trim() === "") {
        (normalized as Record<string, unknown>).body_text_template = null;
      }
    }
    const { error } = await supabase
      .from("email_templates")
      .update(normalized as never)
      .eq("id", id);
    setSaving(false);
    if (error) {
      toast({ title: "Lagring feilet", description: error.message, variant: "destructive" });
      return false;
    }
    toast({ title: "Mal lagret" });
    await reload();
    return true;
  };

  return { templates, loading, saving, saveTemplate, reload };
}
