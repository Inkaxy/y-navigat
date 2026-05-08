UPDATE public.positions
SET is_owner = true
WHERE code IN ('konsernsjef', 'daglig_leder', 'plattform_ansvarlig');