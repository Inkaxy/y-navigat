
ALTER TABLE public.pos_terminals
  ADD COLUMN IF NOT EXISTS terminal_mode text NOT NULL DEFAULT 'cashier'
    CHECK (terminal_mode IN ('cashier','self_service')),
  ADD COLUMN IF NOT EXISTS self_service_operator_id uuid
    REFERENCES public.pos_operators(id) ON DELETE SET NULL;

ALTER TABLE public.pos_keypad_buttons
  ADD COLUMN IF NOT EXISTS hidden_in_self_service boolean NOT NULL DEFAULT false;
