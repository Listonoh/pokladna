-- Require a Supabase user session for database access from the POS.
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pos all categories" ON public.categories;
DROP POLICY IF EXISTS "Staff all categories" ON public.categories;
CREATE POLICY "Staff all categories" ON public.categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Pos all products" ON public.products;
DROP POLICY IF EXISTS "Staff all products" ON public.products;
CREATE POLICY "Staff all products" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Pos all tables" ON public.tables;
DROP POLICY IF EXISTS "Staff all tables" ON public.tables;
CREATE POLICY "Staff all tables" ON public.tables FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Pos all orders" ON public.orders;
DROP POLICY IF EXISTS "Staff all orders" ON public.orders;
CREATE POLICY "Staff all orders" ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Pos all order_items" ON public.order_items;
DROP POLICY IF EXISTS "Staff all order_items" ON public.order_items;
CREATE POLICY "Staff all order_items" ON public.order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Pos all order_item_events" ON public.order_item_events;
DROP POLICY IF EXISTS "Staff all order_item_events" ON public.order_item_events;
CREATE POLICY "Staff all order_item_events" ON public.order_item_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Pos all payments" ON public.payments;
DROP POLICY IF EXISTS "Staff all payments" ON public.payments;
CREATE POLICY "Staff all payments" ON public.payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Pos all payment_events" ON public.payment_events;
DROP POLICY IF EXISTS "Staff all payment_events" ON public.payment_events;
CREATE POLICY "Staff all payment_events" ON public.payment_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

REVOKE EXECUTE ON FUNCTION public.process_payment(TEXT, TEXT, INT, TEXT, INT, JSONB, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_payment(TEXT, TEXT, INT, TEXT, INT, JSONB, INT, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_payment(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_payment(TEXT, TEXT) TO authenticated;
