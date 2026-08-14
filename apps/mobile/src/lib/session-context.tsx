import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { clearToken, getToken, setToken } from '@/lib/session';

/**
 * The keychain answers "is there a token" asynchronously and React cannot
 * render from a promise, so the signed-in state is mirrored into context once
 * on launch and kept in step by signIn/signOut. The navigator's Protected
 * guards read this mirror; the fetch layer keeps reading the keychain
 * directly through getToken.
 */
type Session = {
  /** False until the keychain has been read once; the splash covers this. */
  ready: boolean;
  signedIn: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    getToken().then((token) => {
      setSignedIn(Boolean(token));
      setReady(true);
    });
  }, []);

  const value: Session = {
    ready,
    signedIn,
    async signIn(token) {
      await setToken(token);
      setSignedIn(true);
    },
    async signOut() {
      await clearToken();
      setSignedIn(false);
    },
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
