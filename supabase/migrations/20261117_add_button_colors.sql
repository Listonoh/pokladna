ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS button_color TEXT NOT NULL DEFAULT 'default'
        CHECK (button_color IN ('default', 'gray', 'red', 'green', 'yellow', 'orange', 'blue', 'brown'));

ALTER TABLE public.tables
    ADD COLUMN IF NOT EXISTS button_color TEXT NOT NULL DEFAULT 'default'
        CHECK (button_color IN ('default', 'gray', 'red', 'green', 'yellow', 'orange', 'blue', 'brown'));

NOTIFY pgrst, 'reload schema';
