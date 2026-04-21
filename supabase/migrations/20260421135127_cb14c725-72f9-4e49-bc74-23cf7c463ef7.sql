DO $$
DECLARE
  v_password text := 'Demo2026!';
  v_users jsonb := '[
    {"email":"kari.berg@demo.no","name":"Kari Berg","first":"Kari","last":"Berg","position":"daglig_leder","entity":"NB"},
    {"email":"lars.solheim@demo.no","name":"Lars Solheim","first":"Lars","last":"Solheim","position":"ordrekontor","entity":"NB"},
    {"email":"maja.lund@demo.no","name":"Maja Lund","first":"Maja","last":"Lund","position":"hr_ansvarlig","entity":"NB"},
    {"email":"tom.eriksen@demo.no","name":"Tom Eriksen","first":"Tom","last":"Eriksen","position":"sjafor","entity":"NB"},
    {"email":"ida.strand@demo.no","name":"Ida Strand","first":"Ida","last":"Strand","position":"konditor","entity":"MK"},
    {"email":"ole.nilsen@demo.no","name":"Ole Nilsen","first":"Ole","last":"Nilsen","position":"butikkleder","entity":"NK"}
  ]'::jsonb;
  v_user jsonb;
  v_user_id uuid;
  v_position_id uuid;
  v_entity_id uuid;
BEGIN
  FOR v_user IN SELECT * FROM jsonb_array_elements(v_users)
  LOOP
    SELECT id INTO v_user_id FROM auth.users WHERE email = (v_user->>'email');

    IF v_user_id IS NULL THEN
      v_user_id := gen_random_uuid();

      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change,
        email_change_token_new, recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        v_user_id, 'authenticated', 'authenticated',
        v_user->>'email',
        crypt(v_password, gen_salt('bf')),
        now(),
        jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
        jsonb_build_object('full_name', v_user->>'name'),
        now(), now(), '', '', '', ''
      );

      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_user_id,
        jsonb_build_object('sub', v_user_id::text, 'email', v_user->>'email', 'email_verified', true),
        'email', v_user->>'email',
        now(), now(), now()
      );
    END IF;

    -- Sørg for rad i public.users
    INSERT INTO public.users (id, display_name, first_name, last_name, email)
    VALUES (
      v_user_id,
      v_user->>'name',
      v_user->>'first',
      v_user->>'last',
      v_user->>'email'
    )
    ON CONFLICT (id) DO NOTHING;

    SELECT id INTO v_position_id FROM positions WHERE code = (v_user->>'position');
    SELECT id INTO v_entity_id FROM legal_entities WHERE short_code = (v_user->>'entity');

    INSERT INTO user_positions (user_id, position_id, legal_entity_id, outlet_scope, valid_from)
    SELECT v_user_id, v_position_id, v_entity_id, 'all', current_date
    WHERE NOT EXISTS (
      SELECT 1 FROM user_positions
      WHERE user_id = v_user_id
        AND position_id = v_position_id
        AND legal_entity_id = v_entity_id
    );
  END LOOP;
END $$;