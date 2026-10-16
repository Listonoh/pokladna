import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabasePublishableKey &&
  supabaseUrl !== 'https://your-project.supabase.co' &&
  supabasePublishableKey !== 'your-publishable-key-here'
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null;
