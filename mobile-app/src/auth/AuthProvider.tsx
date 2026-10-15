import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { api, ApiError, type AuthResult, type User, type ApiOptions } from '../api';
import { readSession, saveSession, clearSession } from '../session';

type Auth = {
  defaultMode: 'login' | 'register'; user: User | null; busy: boolean; restoring: boolean; restoreFailed: boolean; notice: string;
  restore: () => Promise<void>;
  authenticate: (mode: 'login' | 'register', body: { email: string; password: string; displayName?: string }) => Promise<void>;
  checkSession: () => Promise<void>;
  logout: () => Promise<void>;
  request: <T>(path: string, options?: Omit<ApiOptions, 'token'>) => Promise<T>;
};
const Context = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ user: User; token: string } | null>(null);
  const currentSession = useRef(session);
  currentSession.current = session;
  const [defaultMode, setDefaultMode] = useState<'login' | 'register'>('register');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [notice, setNotice] = useState('');

  async function restore() {
    setRestoring(true); setRestoreFailed(false); setNotice('');
    try {
      const token = await readSession();
      if (token) {
        try {
          const result = await api<{ user: User }>('/auth/me', { token });
          setSession({ token, user: result.user });
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            await clearSession();
            setDefaultMode('login');
            setNotice('Your session has ended. Please sign in again.');
          } else { throw error; }
        }
      }
    } catch {
      setRestoreFailed(true);
      setNotice('We could not restore your session. Check your connection and try again.');
    } finally { setRestoring(false); }
  }
  useEffect(() => { void restore(); }, []);

  async function authenticate(mode: 'login' | 'register', body: { email: string; password: string; displayName?: string }) {
    setBusy(true); setNotice('');
    try {
      const result = await api<AuthResult>(`/auth/${mode}`, { method: 'POST', body });
      try { await saveSession(result.token); }
      catch { setNotice('You are signed in, but this device could not save your session. You may need to sign in next time.'); }
      setSession({ token: result.token, user: result.user });
    } finally { setBusy(false); }
  }

  async function checkSession() {
    if (!session || busy) return;
    setBusy(true); setNotice('');
    try {
      const result = await api<{ user: User }>('/auth/me', { token: session.token });
      setSession({ ...session, user: result.user });
      setNotice('Your session is active.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setDefaultMode('login');
        setSession(null);
        await clearSession().catch(() => undefined);
        setNotice('Your session has ended. Please sign in again.');
      } else { setNotice(error instanceof Error ? error.message : 'Please try again.'); }
    } finally { setBusy(false); }
  }

  async function logout() {
    if (!session || busy) return;
    setBusy(true); setNotice('');
    try {
      await api<void>('/auth/logout', { method: 'POST', token: session.token });
      await clearSession().catch(() => undefined);
      setDefaultMode('login');
      setSession(null);
      setNotice('You have been signed out.');
    } catch { setNotice('Could not sign out securely. Check your connection and try again.'); }
    finally { setBusy(false); }
  }

  const request = useCallback(async <T,>(path: string, options: Omit<ApiOptions, 'token'> = {}): Promise<T> => {
    const token = session?.token;
    if (!token) throw new ApiError('Please sign in again.', 401);
    try { return await api<T>(path, { ...options, token }); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401 && currentSession.current?.token === token) {
        await clearSession().catch(() => undefined);
        if (currentSession.current?.token === token) {
          setDefaultMode('login'); setSession(null);
          setNotice('Your session has ended. Please sign in again.');
        }
      }
      throw error;
    }
  }, [session?.token]);

  return <Context.Provider value={{ defaultMode, user: session?.user ?? null, busy, restoring, restoreFailed, notice,
    restore, authenticate, checkSession, logout, request }}>{children}</Context.Provider>;
}

export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
