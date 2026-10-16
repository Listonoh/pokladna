-- ==============================================================================
-- Migrace: Pokladní systém čajovny Miska s Listím
-- Oprava typů ID (UUID -> TEXT) pro podporu jak UUIDv4, tak textových slugů (tbl-1..4, prod-..., cat-...)
-- Přidání RLS pro roli 'anon' (Publishable Key) i 'authenticated'
-- Vložení výchozích dat (Kategorie, Stoly, Produkty) do Supabase
-- ==============================================================================

-- 1. Odstranění starých RPC procedur a tabulek
DROP FUNCTION IF EXISTS public.cancel_payment(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_payment(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.process_payment(UUID, UUID, INT, TEXT, INT, JSONB) CASCADE;
DROP FUNCTION IF EXISTS public.process_payment(TEXT, TEXT, INT, TEXT, INT, JSONB) CASCADE;

DROP TABLE IF EXISTS public.payment_events CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.order_item_events CASCADE;
DROP TABLE IF EXISTS public.order_items CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.tables CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;

-- 2. Tabulka kategorií
CREATE TABLE public.categories (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3. Tabulka produktů
CREATE TABLE public.products (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    category_id TEXT NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    price_cents INT NOT NULL CHECK (price_cents >= 0),
    is_favorite BOOLEAN NOT NULL DEFAULT false,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 4. Tabulka stolů
CREATE TABLE public.tables (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 5. Tabulka objednávek
CREATE TABLE public.orders (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    table_id TEXT REFERENCES public.tables(id) ON DELETE SET NULL,
    order_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'cancelled')) DEFAULT 'open',
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    closed_at TIMESTAMPTZ
);

-- 6. Tabulka položek objednávky
CREATE TABLE public.order_items (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    product_name_snapshot TEXT NOT NULL,
    unit_price_cents_snapshot INT NOT NULL CHECK (unit_price_cents_snapshot >= 0),
    quantity INT NOT NULL CHECK (quantity > 0),
    paid_quantity INT NOT NULL DEFAULT 0 CHECK (paid_quantity >= 0 AND paid_quantity <= quantity),
    note TEXT,
    delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'delivered', 'cancelled')) DEFAULT 'pending',
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 7. Auditní tabulka událostí položek objednávky
CREATE TABLE public.order_item_events (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    order_item_id TEXT NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 8. Tabulka plateb
CREATE TABLE public.payments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    amount_cents INT NOT NULL CHECK (amount_cents > 0),
    tip_amount_cents INT NOT NULL DEFAULT 0 CHECK (tip_amount_cents >= 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card')),
    status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled')) DEFAULT 'completed',
    paid_items JSONB DEFAULT '[]'::jsonb,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    cancelled_at TIMESTAMPTZ
);

-- 9. Auditní tabulka událostí plateb
CREATE TABLE public.payment_events (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    payment_id TEXT NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Indexy
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_favorite ON public.products(is_favorite) WHERE is_favorite = true;
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_table ON public.orders(table_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_delivery ON public.order_items(delivery_status);
CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments(created_at);

-- 10. Transakční RPC funkce pro zpracování plateb
CREATE OR REPLACE FUNCTION public.process_payment(
    p_payment_id TEXT,
    p_order_id TEXT,
    p_amount_cents INT,
    p_payment_method TEXT,
    p_tip_amount_cents INT DEFAULT 0,
    p_paid_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_payment RECORD;
    v_order_status TEXT;
    v_total_cents INT := 0;
    v_paid_cents INT := 0;
    v_remaining_cents INT := 0;
    v_new_paid_cents INT := 0;
    v_item JSONB;
BEGIN
    -- Idempotence: pokud platba s tímto ID již existuje, vrátíme ji
    SELECT * INTO v_existing_payment FROM public.payments WHERE id = p_payment_id;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Platba již byla dříve úspěšně zaznamenána.',
            'payment_id', v_existing_payment.id,
            'status', v_existing_payment.status
        );
    END IF;

    -- Kontrola stavu objednávky
    SELECT status INTO v_order_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Objednávka nebyla nalezena.';
    END IF;

    IF v_order_status = 'cancelled' THEN
        RAISE EXCEPTION 'Nelze platit stornovanou objednávku.';
    END IF;

    -- Spočtení celkové ceny položek
    SELECT COALESCE(SUM(unit_price_cents_snapshot * quantity), 0)
    INTO v_total_cents
    FROM public.order_items
    WHERE order_id = p_order_id AND delivery_status != 'cancelled';

    -- Spočtení již zaplacené částky
    SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_paid_cents
    FROM public.payments
    WHERE order_id = p_order_id AND status = 'completed';

    v_remaining_cents := GREATEST(0, v_total_cents - v_paid_cents);

    IF p_amount_cents <= 0 THEN
        RAISE EXCEPTION 'Částka za položky musí být kladná.';
    END IF;

    IF p_tip_amount_cents < 0 THEN
        RAISE EXCEPTION 'Spropitné nemůže být záporné.';
    END IF;

    IF p_amount_cents > v_remaining_cents THEN
        RAISE EXCEPTION 'Částka za položky (%) přesahuje zbývající dluh (%).', p_amount_cents, v_remaining_cents;
    END IF;

    -- Vložení platby
    INSERT INTO public.payments (
        id, order_id, amount_cents, tip_amount_cents, payment_method, status, paid_items, created_at
    ) VALUES (
        p_payment_id, p_order_id, p_amount_cents, p_tip_amount_cents, p_payment_method, 'completed', p_paid_items, timezone('utc', now())
    );

    -- Aktualizace zaplaceného množství na položkách
    IF jsonb_array_length(p_paid_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_paid_items)
        LOOP
            UPDATE public.order_items
            SET paid_quantity = LEAST(quantity, paid_quantity + (v_item->>'quantity')::int),
                updated_at = timezone('utc', now())
            WHERE id = (v_item->>'order_item_id')::text;
        END LOOP;
    END IF;

    -- Audit log události platby
    INSERT INTO public.payment_events (payment_id, event_type, metadata)
    VALUES (
        p_payment_id,
        'created',
        jsonb_build_object(
            'amount_cents', p_amount_cents,
            'tip_amount_cents', p_tip_amount_cents,
            'method', p_payment_method,
            'paid_items', p_paid_items
        )
    );

    -- Kontrola úplného zaplacení a uzavření účtu
    v_new_paid_cents := v_paid_cents + p_amount_cents;

    IF v_new_paid_cents >= v_total_cents AND v_total_cents > 0 THEN
        UPDATE public.orders
        SET status = 'paid', closed_at = timezone('utc', now())
        WHERE id = p_order_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', p_payment_id,
        'remaining_cents', v_total_cents - v_new_paid_cents,
        'is_fully_paid', (v_new_paid_cents >= v_total_cents)
    );
END;
$$;

-- 11. Funkce pro storno platby
CREATE OR REPLACE FUNCTION public.cancel_payment(
    p_payment_id TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id TEXT;
    v_status TEXT;
    v_paid_items JSONB;
    v_item JSONB;
BEGIN
    SELECT order_id, status, paid_items INTO v_order_id, v_status, v_paid_items
    FROM public.payments
    WHERE id = p_payment_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Platba nebyla nalezena.';
    END IF;

    IF v_status = 'cancelled' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Platba již byla stornována.');
    END IF;

    UPDATE public.payments
    SET status = 'cancelled', cancel_reason = p_reason, cancelled_at = timezone('utc', now())
    WHERE id = p_payment_id;

    IF jsonb_array_length(v_paid_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_paid_items)
        LOOP
            UPDATE public.order_items
            SET paid_quantity = GREATEST(0, paid_quantity - (v_item->>'quantity')::int),
                updated_at = timezone('utc', now())
            WHERE id = (v_item->>'order_item_id')::text;
        END LOOP;
    END IF;

    INSERT INTO public.payment_events (payment_id, event_type, metadata)
    VALUES (p_payment_id, 'cancelled', jsonb_build_object('reason', p_reason));

    UPDATE public.orders
    SET status = 'open', closed_at = NULL
    WHERE id = v_order_id AND status = 'paid';

    RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id);
END;
$$;

-- 12. RLS Politiky (Plný přístup pro 'anon' i 'authenticated')
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pos all categories" ON public.categories FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Pos all products" ON public.products FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Pos all tables" ON public.tables FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Pos all orders" ON public.orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Pos all order_items" ON public.order_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Pos all order_item_events" ON public.order_item_events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Pos all payments" ON public.payments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Pos all payment_events" ON public.payment_events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 13. Výchozí data pokladny (Kategorie, Stoly, Produkty)
INSERT INTO public.categories (id, name, sort_order, is_active) VALUES
    ('cat-teas', 'Čaje', 1, true),
    ('cat-drinks', 'Ostatní nápoje', 2, true),
    ('cat-food', 'Drobné jídlo', 3, true),
    ('cat-packaged', 'Balené čaje', 4, true),
    ('cat-other', 'Ostatní', 5, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tables (id, name, sort_order, is_active) VALUES
    ('tbl-1', 'Stůl 1 (Okna)', 1, true),
    ('tbl-2', 'Stůl 2 (Knihovna)', 2, true),
    ('tbl-3', 'Stůl 3 (Bambus)', 3, true),
    ('tbl-4', 'Stůl 4 (Střed)', 4, true),
    ('tbl-tatami', 'Čajové pódium (Tatami)', 5, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.products (id, category_id, name, price_cents, is_favorite, sort_order, is_active) VALUES
    ('prod-gyokuro', 'cat-teas', 'Gyokuro Asahina', 14500, true, 1, true),
    ('prod-sencha', 'cat-teas', 'Sencha Fukamushi', 9500, true, 2, true),
    ('prod-longjing', 'cat-teas', 'Long Jing Dračí studna', 12000, true, 3, true),
    ('prod-da-hong-pao', 'cat-teas', 'Da Hong Pao Oolong', 13500, true, 4, true),
    ('prod-matcha-latte', 'cat-drinks', 'Matcha Latte z ovesného mléka', 9800, true, 1, true),
    ('prod-mochi', 'cat-food', 'Mochi koláček se sezamem', 5500, true, 1, true),
    ('prod-cookies', 'cat-food', 'Domácí čajové sušenky', 4500, false, 2, true),
    ('prod-lemonade', 'cat-drinks', 'Jasmínová limonáda', 7500, false, 2, true)
ON CONFLICT (id) DO NOTHING;
