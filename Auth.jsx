import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from './supabase.js';

const AuthContext = createContext(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthGate');
  return context;
}

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setLoading(false);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const authValue = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      signOut: () => supabase.auth.signOut(),
    }),
    [session],
  );

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setMessage('Account created. Check your email, confirm it, and then sign in.');
          setMode('signin');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      setMessage(error.message || 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="auth-screen">
        <div className="auth-card setup-card">
          <div className="auth-logo">M</div>
          <h1>MCAT Question Log</h1>
          <p>The cloud connection has not been added yet.</p>
          <div className="setup-code">
            <strong>Missing Vercel variables</strong>
            <code>VITE_SUPABASE_URL</code>
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>
          </div>
          <p className="auth-help">Add both values in Vercel, then redeploy the project.</p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="loading-screen">Opening your secure question log…</div>;

  if (!session) {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-logo">M</div>
          <h1>MCAT Question Log</h1>
          <p>{mode === 'signin' ? 'Sign in to your private question log.' : 'Create your private account.'}</p>

          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </label>

          {message && <div className="auth-message">{message}</div>}

          <button className="auth-primary" type="submit" disabled={submitting}>
            {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>

          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setMode((current) => (current === 'signin' ? 'signup' : 'signin'));
              setMessage('');
            }}
          >
            {mode === 'signin' ? 'Create an account' : 'Already have an account? Sign in'}
          </button>
        </form>
      </div>
    );
  }

  return <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>;
}
