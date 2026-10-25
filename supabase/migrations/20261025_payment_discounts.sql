ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS discount_percent INT NOT NULL DEFAULT 0
        CHECK (discount_percent IN (0, 25, 75)),
    ADD COLUMN IF NOT EXISTS discount_cents INT NOT NULL DEFAULT 0
        CHECK (discount_cents >= 0);

DROP FUNCTION IF EXISTS public.process_payment(TEXT, TEXT, INT, TEXT, INT, JSONB);

CREATE OR REPLACE FUNCTION public.process_payment(
    p_payment_id TEXT,
    p_order_id TEXT,
    p_amount_cents INT,
    p_payment_method TEXT,
    p_tip_amount_cents INT DEFAULT 0,
    p_paid_items JSONB DEFAULT '[]'::jsonb,
    p_discount_cents INT DEFAULT 0,
    p_discount_percent INT DEFAULT 0
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
    v_gross_selected_cents INT := 0;
    v_item JSONB;
BEGIN
    SELECT * INTO v_existing_payment FROM public.payments WHERE id = p_payment_id;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Platba již byla dříve úspěšně zaznamenána.',
            'payment_id', v_existing_payment.id,
            'status', v_existing_payment.status
        );
    END IF;

    SELECT status INTO v_order_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Objednávka nebyla nalezena.';
    END IF;
    IF v_order_status = 'cancelled' THEN
        RAISE EXCEPTION 'Nelze platit stornovanou objednávku.';
    END IF;

    SELECT COALESCE(SUM(unit_price_cents_snapshot * quantity), 0)
    INTO v_total_cents
    FROM public.order_items
    WHERE order_id = p_order_id AND delivery_status != 'cancelled';

    SELECT COALESCE(SUM(amount_cents + discount_cents), 0)
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
    IF p_discount_cents < 0 OR p_discount_percent NOT IN (0, 25, 75) THEN
        RAISE EXCEPTION 'Neplatná sleva.';
    END IF;
    IF jsonb_array_length(p_paid_items) > 0 THEN
        SELECT COALESCE(SUM((value->>'total_cents')::int), 0)
        INTO v_gross_selected_cents
        FROM jsonb_array_elements(p_paid_items);

        IF p_discount_cents != ROUND(v_gross_selected_cents * p_discount_percent / 100.0)
           OR p_amount_cents != v_gross_selected_cents - p_discount_cents THEN
            RAISE EXCEPTION 'Částka platby neodpovídá ceně položek po slevě.';
        END IF;
    ELSIF p_discount_cents > 0 OR p_discount_percent > 0 THEN
        RAISE EXCEPTION 'Pro uplatnění slevy musí být uvedeny hrazené položky.';
    END IF;
    IF p_amount_cents + p_discount_cents > v_remaining_cents THEN
        RAISE EXCEPTION 'Částka za položky (%) přesahuje zbývající dluh (%).', p_amount_cents + p_discount_cents, v_remaining_cents;
    END IF;

    INSERT INTO public.payments (
        id, order_id, amount_cents, discount_percent, discount_cents,
        tip_amount_cents, payment_method, status, paid_items, created_at
    ) VALUES (
        p_payment_id, p_order_id, p_amount_cents, p_discount_percent, p_discount_cents,
        p_tip_amount_cents, p_payment_method, 'completed', p_paid_items, timezone('utc', now())
    );

    IF jsonb_array_length(p_paid_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_paid_items)
        LOOP
            UPDATE public.order_items
            SET paid_quantity = LEAST(quantity, paid_quantity + (v_item->>'quantity')::int),
                updated_at = timezone('utc', now())
            WHERE id = (v_item->>'order_item_id')::text;
        END LOOP;
    END IF;

    INSERT INTO public.payment_events (payment_id, event_type, metadata)
    VALUES (
        p_payment_id,
        'created',
        jsonb_build_object(
            'amount_cents', p_amount_cents,
            'discount_percent', p_discount_percent,
            'discount_cents', p_discount_cents,
            'tip_amount_cents', p_tip_amount_cents,
            'method', p_payment_method,
            'paid_items', p_paid_items
        )
    );

    v_new_paid_cents := v_paid_cents + p_amount_cents + p_discount_cents;
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
