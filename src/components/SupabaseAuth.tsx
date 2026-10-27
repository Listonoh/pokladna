import React, { FormEvent, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../api/supabaseClient';
import { User } from '@supabase/supabase-js';

export const SupabaseAuth: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const { error: authError } = user
        ? await supabase.auth.signOut()
        : await supabase.auth.signInWithPassword({ email, password });

      if (authError) throw authError;
      setPassword('');
      setShowDialog(false);
    } catch (authError: unknown) {
      setError(authError instanceof Error ? authError.message : String(authError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setShowDialog(true);
        }}
        disabled={!isSupabaseConfigured || !authReady}
        title={!isSupabaseConfigured ? 'Nejprve nakonfigurujte Supabase v .env' : undefined}
        className="px-3 py-1.5 rounded-lg border border-tea-600/70 bg-tea-700/50 text-xs text-tea-50 hover:bg-tea-600 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {!isSupabaseConfigured
          ? 'Supabase není nastaven'
          : user
            ? 'Účet'
            : 'Přihlásit'}
      </button>

      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form
            onSubmit={handleSubmit}
            className="bg-parchment-50 text-tea-900 rounded-2xl max-w-sm w-full p-6 shadow-2xl"
          >
            <h2 className="font-semibold text-lg mb-1">Supabase účet</h2>
            {user ? (
              <>
                <p className="text-sm text-stone-600 mb-5 break-all">
                  Přihlášeno jako {user.email}
                </p>
                {error && <p role="alert" className="text-sm text-rose-700 mb-4">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDialog(false)}
                    className="px-4 py-2 text-sm rounded-lg border border-stone-300"
                  >
                    Zavřít
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 text-sm rounded-lg bg-tea-700 text-white disabled:opacity-60"
                  >
                    {isSubmitting ? 'Odhlášení…' : 'Odhlásit'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-stone-600 mb-4">
                  Přihlášení zapne synchronizaci se Supabase. Pokladna zůstává dostupná i offline.
                </p>
                <label className="block text-sm font-medium mb-3">
                  E-mail
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm font-medium mb-4">
                  Heslo
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
                  />
                </label>
                {error && <p role="alert" className="text-sm text-rose-700 mb-4">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDialog(false)}
                    className="px-4 py-2 text-sm rounded-lg border border-stone-300"
                  >
                    Zrušit
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 text-sm rounded-lg bg-tea-700 text-white disabled:opacity-60"
                  >
                    {isSubmitting ? 'Přihlašování…' : 'Přihlásit'}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
};
