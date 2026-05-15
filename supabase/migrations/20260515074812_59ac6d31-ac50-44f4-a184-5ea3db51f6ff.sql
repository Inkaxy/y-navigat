DO $$
DECLARE cid uuid := '0c49b619-6296-4b58-9755-388001a96ed9';
BEGIN
  DELETE FROM delivery_note_lines WHERE delivery_note_id IN (SELECT id FROM delivery_notes WHERE customer_id = cid);
  DELETE FROM delivery_notes WHERE customer_id = cid;
  DELETE FROM order_lines WHERE order_id IN (SELECT id FROM orders WHERE customer_id = cid);
  DELETE FROM orders WHERE customer_id = cid;
  DELETE FROM special_prices WHERE customer_id = cid;
  DELETE FROM customers WHERE id = cid;
END $$;