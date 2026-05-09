CREATE TABLE public.user_ui_preferences (
  user_id uuid NOT NULL,
  scope text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope)
);

ALTER TABLE public.user_ui_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ui prefs"
  ON public.user_ui_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ui prefs"
  ON public.user_ui_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ui prefs"
  ON public.user_ui_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own ui prefs"
  ON public.user_ui_preferences FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_user_ui_preferences_updated_at
  BEFORE UPDATE ON public.user_ui_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();