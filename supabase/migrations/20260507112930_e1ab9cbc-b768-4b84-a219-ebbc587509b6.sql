UPDATE public.customers
SET geocode_latitude = 59.213,
    geocode_longitude = 10.408,
    geocode_source = 'manual_dev_fixture',
    geocode_updated_at = now()
WHERE customer_number = '20002'
  AND id = '77523c7d-ac9a-4c32-a07a-4a8592665de3';