-- ==============================================================================
-- Migrace: Pokladní systém čajovny Miska s Listím
-- Inicializace schématu, tabulek, indexů, RLS a transakčních RPC funkcí
-- ==============================================================================

-- 1. Tabulka kategorií
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 2. Tabulka produktů
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    price_cents INT NOT NULL CHECK (price_cents >= 0),
    is_favorite BOOLEAN NOT NULL DEFAULT false,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3. Tabulka stolů
CREATE TABLE IF NOT EXISTS public.tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 4. Tabulka objednávek
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID REFERENCES public.tables(id) ON DELETE SET NULL,
    order_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'cancelled')) DEFAULT 'open',
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    closed_at TIMESTAMPTZ
);

-- 5. Tabulka položek objednávky
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    product_name_snapshot TEXT NOT NULL,
    unit_price_cents_snapshot INT NOT NULL CHECK (unit_price_cents_snapshot >= 0),
    quantity INT NOT NULL CHECK (quantity > 0),
    note TEXT,
    delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'delivered', 'cancelled')) DEFAULT 'pending',
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 6. Auditní tabulka událostí položek objednávky (historie doručení)
CREATE TABLE IF NOT EXISTS public.order_item_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 7. Tabulka plateb (s idempotentním UUID v4 klientským klíčem)
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    amount_cents INT NOT NULL CHECK (amount_cents > 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card')),
    status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled')) DEFAULT 'completed',
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    cancelled_at TIMESTAMPTZ
);

-- 8. Auditní tabulka událostí plateb
CREATE TABLE IF NOT EXISTS public.payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Indexy pro optimalizaci výkonu dotazů
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_favorite ON public.products(is_favorite) WHERE is_favorite = true;
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_table ON public.orders(table_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_delivery ON public.order_items(delivery_status);
CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments(created_at);

-- ==============================================================================
-- Transakční RPC funkce pro platby s ochranou proti přeplatku a idempotencí
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.process_payment(
    p_payment_id UUID,
    p_order_id UUID,
    p_amount_cents INT,
    p_payment_method TEXT
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
    v_all_delivered BOOLEAN := false;
    v_pending_count INT := 0;
BEGIN
    -- 1. Idempotence: pokud platba s tímto ID již existuje, vrátíme ji
    SELECT * INTO v_existing_payment FROM public.payments WHERE id = p_payment_id;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Platba již byla dříve úspěšně zaznamenána.',
            'payment_id', v_existing_payment.id,
            'status', v_existing_payment.status
        );
    END IF;

    -- 2. Ověření existence a stavu objednávky
    SELECT status INTO v_order_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Objednávka nebyla nalezena.';
    END IF;

    IF v_order_status = 'cancelled' THEN
        RAISE EXCEPTION 'Nelze platit stornovanou objednávku.';
    END IF;

    -- 3. Spočtení celkové ceny aktivních položek
    SELECT COALESCE(SUM(unit_price_cents_snapshot * quantity), 0)
    INTO v_total_cents
    FROM public.order_items
    WHERE order_id = p_order_id AND delivery_status != 'cancelled';

    -- 4. Spočtení dosud zaplacených platných plateb
    SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_paid_cents
    FROM public.payments
    WHERE order_id = p_order_id AND status = 'completed';

    v_remaining_cents := GREATEST(0, v_total_cents - v_paid_cents);

    -- 5. Striktní kontrola přeplatku
    IF p_amount_cents <= 0 THEN
        RAISE EXCEPTION 'Částka platby musí být kladná.';
    END IF;

    IF p_amount_cents > v_remaining_cents THEN
        RAISE EXCEPTION 'Částka platby (%) přesahuje zbývající dluh (%).', p_amount_cents, v_remaining_cents;
    END IF;

    -- 6. Vložení nové platby
    INSERT INTO public.payments (id, order_id, amount_cents, payment_method, status, created_at)
    VALUES (p_payment_id, p_order_id, p_amount_cents, p_payment_method, 'completed', timezone('utc', now()));

    -- 7. Audit log události
    INSERT INTO public.payment_events (payment_id, event_type, metadata)
    VALUES (p_payment_id, 'created', jsonb_build_object('amount_cents', p_amount_cents, 'method', p_payment_method));

    -- 8. Kontrola doručení a případné uzavření objednávky
    v_new_paid_cents := v_paid_cents + p_amount_cents;
    SELECT COUNT(*) INTO v_pending_count
    FROM public.order_items
    WHERE order_id = p_order_id AND delivery_status = 'pending';

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

-- ==============================================================================
-- Funkce pro bezpečné storno platby
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.cancel_payment(
    p_payment_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id UUID;
    v_status TEXT;
BEGIN
    SELECT order_id, status INTO v_order_id, v_status
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

    INSERT INTO public.payment_events (payment_id, event_type, metadata)
    VALUES (p_payment_id, 'cancelled', jsonb_build_object('reason', p_reason));

    -- Znovu otevřít objednávku, pokud byla označena jako zaplacená
    UPDATE public.orders
    SET status = 'open', closed_at = NULL
    WHERE id = v_order_id AND status = 'paid';

    RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id);
END;
$$;

-- ==============================================================================
-- RLS Bezpečnostní Politiky
-- ==============================================================================

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- Politika: Autentizovaný personál má plný přístup
CREATE POLICY "Staff all categories" ON public.categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff all products" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff all tables" ON public.tables FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff all orders" ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff all order_items" ON public.order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff all order_item_events" ON public.order_item_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff all payments" ON public.payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff all payment_events" ON public.payment_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
