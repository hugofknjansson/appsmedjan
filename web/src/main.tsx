import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, type User } from './api';
import { Auth } from './Auth';
import { Dashboard } from './Dashboard';
import { Project } from './Project';
import './styles.css';

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [path, setPath] = useState(location.pathname);

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    history.pushState({}, '', to);
    setPath(to);
  }, []);

  if (user === undefined) return null;
  if (user === null) return <Auth onDone={setUser} />;

  const project = /^\/p\/([a-z0-9]+)$/.exec(path);
  if (project) return <Project key={project[1]} id={project[1]!} navigate={navigate} />;
  return (
    <Dashboard
      user={user}
      navigate={navigate}
      onLogout={() => {
        void api.logout().finally(() => {
          setUser(null);
          navigate('/');
        });
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
