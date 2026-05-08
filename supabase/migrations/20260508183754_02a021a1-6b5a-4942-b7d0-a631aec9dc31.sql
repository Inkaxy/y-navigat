
-- 1. Slett etikett-printjobber knyttet til demo-ordrelinjer (blokkerer cascade)
delete from public.label_print_jobs
where order_line_id in (
  select ol.id from public.order_lines ol
  join public.orders o on o.id = ol.order_id
  join public.customers c on c.id = o.customer_id
  where c.display_name like '[DEMO]%' or c.organization_number like '[DEMO]%'
);

-- 2. Slett pakksedler (cascader pakkseddel-linjer)
delete from public.delivery_notes
where customer_id in (
  select id from public.customers
  where display_name like '[DEMO]%' or organization_number like '[DEMO]%'
);

-- 3. Slett ordrer (cascader ordrelinjer + statushistorikk)
delete from public.orders
where customer_id in (
  select id from public.customers
  where display_name like '[DEMO]%' or organization_number like '[DEMO]%'
);

-- 4. Slett selve kundene (cascader recurring/special_prices/portal_accounts)
delete from public.customers
where display_name like '[DEMO]%' or organization_number like '[DEMO]%';
