import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext';

const NAV = [
  { to: '/catalogo', label: 'Catálogo' },
  { to: '/listas', label: 'Listas' },
  { to: '/revisao', label: 'Revisão' },
  { to: '/atividade', label: 'Atividade' },
  { to: '/perfil', label: 'Perfil' },
  { to: '/sandbox', label: 'Sandbox' },
];

export function Layout() {
  const { email, signOut } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Fruiqo</div>
        <nav aria-label="Seções">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="muted">{email ?? 'Conectado'}</span>
          <button type="button" className="btn" onClick={() => void signOut()}>
            Sair
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
