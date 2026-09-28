import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { BrandMark, Icon, Menu, ThemeToggle, type IconName } from './ui';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/catalogo', label: 'Catálogo', icon: 'film' },
  { to: '/listas', label: 'Listas', icon: 'list' },
  { to: '/revisao', label: 'Revisão', icon: 'review' },
  { to: '/atividade', label: 'Atividade', icon: 'activity' },
  { to: '/perfil', label: 'Perfil', icon: 'user' },
  { to: '/sandbox', label: 'Sandbox', icon: 'flask' },
];

export function Layout() {
  const { email, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  const onCatalog = location.pathname.startsWith('/catalogo');

  // com o catálogo aberto, o campo global reflete a busca atual da URL
  useEffect(() => {
    if (onCatalog) setQ(new URLSearchParams(location.search).get('q') ?? '');
  }, [onCatalog, location.search]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    // já no catálogo: troca só a busca e mantém os outros filtros
    const next = onCatalog ? new URLSearchParams(location.search) : new URLSearchParams();
    if (term) next.set('q', term);
    else next.delete('q');
    const qs = next.toString();
    navigate(qs ? `/catalogo?${qs}` : '/catalogo', { replace: onCatalog });
  };

  const initial = (email ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/catalogo" className="brand" aria-label="Fruiqo, ir para o catálogo">
          <BrandMark />
          <span>
            <span className="brand-name">Fruiqo</span>
            <span className="brand-sub">organizar</span>
          </span>
        </NavLink>
        <nav aria-label="Seções">
          <span className="nav-label">Navegação</span>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          Dados de filmes e séries: TMDB. Disponibilidade: JustWatch.
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <form className="topbar-search" role="search" onSubmit={search}>
            <Icon name="search" />
            <input
              type="search"
              aria-label="Buscar no catálogo"
              placeholder="Buscar filmes, séries e músicas…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
          <div className="topbar-actions">
            <ThemeToggle />
            <Menu
              label="Menu do usuário"
              triggerClassName="user-chip"
              trigger={
                <>
                  <span className="avatar" aria-hidden="true">
                    {initial}
                  </span>
                  <span className="email">{email ?? 'Conectado'}</span>
                  <Icon name="down" size={14} />
                </>
              }
            >
              {(close) => (
                <>
                  <div className="menu-head">Conta</div>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      close();
                      navigate('/perfil');
                    }}
                  >
                    <Icon name="user" /> Perfil e privacidade
                  </button>
                  <div className="menu-sep" />
                  <button type="button" className="menu-item" onClick={() => void signOut()}>
                    <Icon name="logout" /> Sair
                  </button>
                </>
              )}
            </Menu>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
