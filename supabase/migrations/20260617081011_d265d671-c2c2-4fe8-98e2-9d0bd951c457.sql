
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.cleanup_old_printed_cake_images()
RETURNS TABLE(deleted_rows int, deleted_objects int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_rows int := 0;
  v_deleted_objects int := 0;
BEGIN
  WITH le AS (
    SELECT id,
           GREATEST(
             COALESCE((settings->>'cake_images_retention_days')::int, 30),
             1
           ) AS days
    FROM public.legal_entities
  ),
  victims AS (
    SELECT ci.id, ci.original_path, ci.edited_path
    FROM public.cake_images ci
    JOIN le ON le.id = ci.legal_entity_id
    WHERE ci.status = 'skrevet_ut'
      AND ci.printed_at IS NOT NULL
      AND ci.printed_at < now() - make_interval(days => le.days)
  ),
  paths AS (
    SELECT original_path AS p FROM victims
    UNION
    SELECT edited_path FROM victims WHERE edited_path IS NOT NULL
  ),
  obj_del AS (
    DELETE FROM storage.objects
    WHERE bucket_id = 'cake-images'
      AND name IN (SELECT p FROM paths)
    RETURNING 1
  ),
  row_del AS (
    DELETE FROM public.cake_images
    WHERE id IN (SELECT id FROM victims)
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM row_del),
    (SELECT count(*) FROM obj_del)
  INTO v_deleted_rows, v_deleted_objects;

  RETURN QUERY SELECT v_deleted_rows, v_deleted_objects;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_printed_cake_images() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_printed_cake_images() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-old-printed-cake-images');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cleanup-old-printed-cake-images',
  '15 3 * * *',
  $$ SELECT public.cleanup_old_printed_cake_images(); $$
);
