-- 1) New column on pos_keypad_buttons
ALTER TABLE public.pos_keypad_buttons
  ADD COLUMN IF NOT EXISTS image_storage_path text;

-- 2) Backfill from pos_product_images primary
UPDATE public.pos_keypad_buttons b
SET image_storage_path = pi.storage_path
FROM public.pos_product_images pi
WHERE b.button_type = 'product'
  AND b.product_id = pi.product_id
  AND pi.is_primary = true
  AND b.image_storage_path IS NULL;

-- 3) Clear expired signed URLs that were persisted in image_url
UPDATE public.pos_keypad_buttons
SET image_url = NULL
WHERE image_url ILIKE '%/storage/v1/object/sign/pos-product-images/%'
  AND image_url ILIKE '%token=%';

-- 4) Helper: is current auth.uid a kiosk user?
CREATE OR REPLACE FUNCTION public.is_kiosk_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pos_kiosk_users WHERE user_id = auth.uid()
  );
$$;

-- 5) Storage SELECT policy: kiosk users may read pos-product-images
DROP POLICY IF EXISTS "pos_product_images_kiosk_select" ON storage.objects;
CREATE POLICY "pos_product_images_kiosk_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'pos-product-images'
  AND public.is_kiosk_user()
);