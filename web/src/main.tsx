import { StrictMode, useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { api, type User } from './api';
import { ResetPassword } from './Account';
import { Auth } from './Auth';
import { Dashboard } from './Dashboard';
import { Project } from './Project';
import { Waiting } from './Waiting';
import { LevelNote } from './LevelNote';
import { forgetLevel } from './level';
import './styles.css';

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [path, setPath] = useState(location.pathname);
  /** The page that was just opened out of the card it was asked for in, straight into the show of it being built. */
  const [grown, setGrown] = useState<string | null>(null);

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /**
   * `grow`: the new page grows out of the start card, where the browser can do that (and the person
   * has not asked for less motion). What is named `start` on both pages is what morphs.
   */
  const navigate = useCallback((to: string, options?: { grow?: boolean }) => {
    const go = () => {
      history.pushState({}, '', to);
      setPath(to);
      setGrown(options?.grow ? to : null);
    };
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (options?.grow && !still && typeof document.startViewTransition === 'function') {
      const transition = document.startViewTransition(() => flushSync(go));
      // A tab in the background skips the movement; the page changes all the same.
      transition.ready.catch(() => undefined);
      transition.finished.catch(() => undefined);
    } else {
      go();
    }
  }, []);

  if (user === undefined) return <Waiting page />;
  // The link in the mail for a new password: works signed in or out, and signs the person in.
  const reset = /^\/reset\/([A-Za-z0-9_-]{20,100})$/.exec(path);
  if (reset) {
    return (
      <ResetPassword
        token={reset[1]!}
        onDone={(signedIn) => {
          setUser(signedIn);
          navigate('/');
        }}
      />
    );
  }
  if (user === null) return <Auth onDone={setUser} />;

  const project = /^\/p\/([a-z0-9]+)$/.exec(path);
  return (
    <>
      {project ? (
        <Project key={project[1]} id={project[1]!} isNew={grown === path} navigate={navigate} />
      ) : (
        <Dashboard
          user={user}
          navigate={navigate}
          onLogout={() => {
            void api.logout().finally(() => {
              forgetLevel();
              setUser(null);
              navigate('/');
            });
          }}
        />
      )}
      <LevelNote />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
