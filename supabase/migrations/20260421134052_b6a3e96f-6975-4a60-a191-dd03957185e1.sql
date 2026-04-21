-- Sett demo-passord for testbrukere
UPDATE auth.users
SET encrypted_password = crypt('Demo2026!', gen_salt('bf')),
    updated_at = now()
WHERE email IN ('anne.hansen@demo.no', 'per.olsen@demo.no');