INSERT INTO position_app_access (position_id, app_id, level)
SELECT p.id, '8685c890-1e98-46b4-b3af-7c31b3710834'::uuid,
  CASE WHEN p.code IN ('daglig_leder','lageransvarlig') OR p.id = 'fb328e43-527a-4168-b3d3-c53ab367fc2f' THEN 'admin'::access_level
       WHEN p.code = 'ordrekontor' THEN 'write'::access_level
  END
FROM positions p
WHERE p.code IN ('daglig_leder','lageransvarlig','ordrekontor') OR p.id = 'fb328e43-527a-4168-b3d3-c53ab367fc2f'
ON CONFLICT (position_id, app_id) DO NOTHING;