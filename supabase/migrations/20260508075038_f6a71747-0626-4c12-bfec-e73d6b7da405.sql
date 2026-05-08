-- 1) Storage buckets
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('declaration-uploads', 'declaration-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- 2) RLS for product-images: alle ser, varer-skrivetilgang kan laste opp/slette
CREATE POLICY "product-images public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

CREATE POLICY "product-images varer write insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'product-images' AND public.has_app_write_access('varer'));

CREATE POLICY "product-images varer write update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'product-images' AND public.has_app_write_access('varer'));

CREATE POLICY "product-images varer write delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'product-images' AND public.has_app_write_access('varer'));

-- 3) RLS for declaration-uploads: bare varer-skrivetilgang
CREATE POLICY "declaration-uploads varer read"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'declaration-uploads' AND public.has_app_write_access('varer'));

CREATE POLICY "declaration-uploads varer insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'declaration-uploads' AND public.has_app_write_access('varer'));

CREATE POLICY "declaration-uploads varer delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'declaration-uploads' AND public.has_app_write_access('varer'));

-- 4) platform_settings: Varer admin kan styre AI-konfig
CREATE POLICY "platform_settings_select_varer_ai"
ON public.platform_settings FOR SELECT
TO authenticated
USING (category = 'varer_ai' AND public.has_app_admin_access('varer'));

CREATE POLICY "platform_settings_insert_varer_ai"
ON public.platform_settings FOR INSERT
TO authenticated
WITH CHECK (category = 'varer_ai' AND public.has_app_admin_access('varer'));

CREATE POLICY "platform_settings_update_varer_ai"
ON public.platform_settings FOR UPDATE
TO authenticated
USING (category = 'varer_ai' AND public.has_app_admin_access('varer'))
WITH CHECK (category = 'varer_ai' AND public.has_app_admin_access('varer'));