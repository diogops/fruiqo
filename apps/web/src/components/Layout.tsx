import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { SHOW_DEV_TOOLS } from '../devTools';
import { useRouteAutofocus } from './autofocus';
import { BrandMark, Icon, Menu, MQ, ThemeToggle, useFocusTrap, useMediaQuery, type IconName } from './ui';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/hoje', label: 'Assistir hoje', icon: 'play' },
  { to: '/minha-area', label: 'Minha Área', icon: 'star' },
  { to: '/catalogo', label: 'Catálogo', icon: 'film' },
  { to: '/como-estou', label: 'Como estou', icon: 'sparkles' },
  { to: '/listas', label: 'Listas', icon: 'list' },
  { to: '/atividade', label: 'Atividade', icon: 'activity' },
  { to: '/perfil', label: 'Perfil', icon: 'user' },
  ...(SHOW_DEV_TOOLS ? [{ to: '/sandbox', label: 'Sandbox', icon: 'flask' as IconName }] : []),
];

const COLLAPSE_KEY = 'fruiqo-sidebar-collapsed';

function readCollapsed(): boolean | null {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

export function Layout() {
  const { email, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // primeiro acesso (perfil vazio, o servidor decide): abre o Perfil uma vez para definir o gosto
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const onboardingSent = useRef(false);
  useEffect(() => {
    if (!settings.data?.onboarding || onboardingSent.current || location.pathname === '/perfil') return;
    onboardingSent.current = true;
    navigate('/perfil?boas-vindas=1', { replace: true });
  }, [settings.data?.onboarding, location.pathname, navigate]);
  const [q, setQ] = useState('');
  const onCatalog = location.pathname.startsWith('/catalogo');

  // ≤1024: sidebar vira drawer; 1025–1280: recolhida (só ícones) por padrão, com preferência salva
  const isDrawer = useMediaQuery(MQ.drawer);
  const isCompactRange = useMediaQuery(MQ.compact);
  const isSmall = useMediaQuery(MQ.small);
  const [navOpen, setNavOpen] = useState(false);
  const [collapsedPref, setCollapsedPref] = useState<boolean | null>(readCollapsed);
  const collapsed = !isDrawer && (collapsedPref ?? isCompactRange);
  const [searchOpen, setSearchOpen] = useState(false);

  const sidebarRef = useRef<HTMLElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useFocusTrap(sidebarRef, isDrawer && navOpen);
  useRouteAutofocus(mainRef, location.pathname);

  // com o catálogo aberto, o campo global reflete a busca atual da URL
  useEffect(() => {
    if (onCatalog) setQ(new URLSearchParams(location.search).get('q') ?? '');
  }, [onCatalog, location.search]);

  // navegar fecha o drawer
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // saiu do modo drawer: garante estado fechado
  useEffect(() => {
    if (!isDrawer) setNavOpen(false);
  }, [isDrawer]);

  // drawer aberto: Esc fecha, trava a rolagem da página e foca o primeiro link
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeNav();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLElement>('.nav-link')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (!isSmall) setSearchOpen(false);
  }, [isSmall]);

  function closeNav() {
    setNavOpen(false);
    menuBtnRef.current?.focus();
  }

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsedPref(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* ignora */
    }
  }

  const search = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    // já no catálogo: troca só a busca e mantém os outros filtros
    const next = onCatalog ? new URLSearchParams(location.search) : new URLSearchParams();
    if (term) next.set('q', term);
    else next.delete('q');
    const qs = next.toString();
    navigate(qs ? `/catalogo?${qs}` : '/catalogo', { replace: onCatalog });
    setSearchOpen(false);
  };

  const initial = (email ?? '?').trim().charAt(0).toUpperCase();
  const sidebarClass = ['sidebar', collapsed ? 'collapsed' : '', isDrawer ? 'drawer' : '', isDrawer && navOpen ? 'open' : '']
    .filter(Boolean)
    .join(' ');
  const hiddenDrawer = isDrawer && !navOpen;

  return (
    <div className={collapsed ? 'shell shell-collapsed' : 'shell'}>
      {isDrawer && navOpen && <div className="drawer-backdrop" onClick={closeNav} aria-hidden="true" />}
      <aside
        ref={sidebarRef}
        id="app-sidebar"
        className={sidebarClass}
        aria-label="Menu principal"
        {...(isDrawer ? { role: 'dialog', 'aria-modal': navOpen ? true : undefined } : {})}
        aria-hidden={hiddenDrawer || undefined}
        inert={hiddenDrawer || undefined}
      >
        <div className="sidebar-top">
          <NavLink to="/catalogo" className="brand" aria-label="Fruiqo, ir para o catálogo">
            <BrandMark />
            <span className="brand-text">
              <span className="brand-name">Fruiqo</span>
              <span className="brand-sub">organizar</span>
            </span>
          </NavLink>
          {isDrawer && (
            <button type="button" className="icon-btn drawer-close" aria-label="Fechar menu" onClick={closeNav}>
              <Icon name="x" />
            </button>
          )}
        </div>
        <nav aria-label="Seções">
          <span className="nav-label">Navegação</span>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={collapsed ? n.label : undefined}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <Icon name={n.icon} />
              <span className="nav-text">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">Dados de filmes e séries: TMDB. Disponibilidade: JustWatch.</div>
        {!isDrawer && (
          <button
            type="button"
            className="nav-link collapse-toggle"
            aria-pressed={collapsed}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            onClick={toggleCollapsed}
          >
            <Icon name="sidebar" />
            <span className="nav-text">{collapsed ? 'Expandir menu' : 'Recolher menu'}</span>
          </button>
        )}
      </aside>
      <div className="main">
        <header className={searchOpen ? 'topbar search-open' : 'topbar'}>
          {isDrawer && (
            <>
              <button
                ref={menuBtnRef}
                type="button"
                className="icon-btn menu-toggle"
                aria-label="Abrir menu"
                aria-controls="app-sidebar"
                aria-expanded={navOpen}
                onClick={() => setNavOpen(true)}
              >
                <Icon name="menu" />
              </button>
              <NavLink to="/catalogo" className="topbar-brand" aria-label="Fruiqo, ir para o catálogo">
                <BrandMark />
              </NavLink>
            </>
          )}
          {(!isSmall || searchOpen) && (
            <form className="topbar-search" role="search" onSubmit={search}>
              <Icon name="search" />
              <input
                ref={searchRef}
                type="search"
                aria-label="Buscar no catálogo"
                placeholder="Buscar filmes, séries, livros e músicas…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && isSmall) setSearchOpen(false);
                }}
              />
              {isSmall && (
                <button type="button" className="icon-btn" aria-label="Fechar busca" onClick={() => setSearchOpen(false)}>
                  <Icon name="x" />
                </button>
              )}
            </form>
          )}
          {!(isSmall && searchOpen) && (
            <div className="topbar-actions">
              {isSmall && (
                <button type="button" className="icon-btn" aria-label="Buscar" onClick={() => setSearchOpen(true)}>
                  <Icon name="search" />
                </button>
              )}
              {location.pathname !== '/hoje' && (
                <button
                  type="button"
                  className={isSmall ? 'icon-btn tonight-btn' : 'btn btn-primary tonight-btn'}
                  aria-label="O que assistir hoje?"
                  title="O que assistir hoje?"
                  onClick={() => navigate('/hoje')}
                >
                  <Icon name="sparkles" size={isSmall ? 18 : 14} />
                  {!isSmall && <span>O que assistir hoje?</span>}
                </button>
              )}
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
                    <div className="menu-head">{email ?? 'Conta'}</div>
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
          )}
        </header>
        <main className="content" ref={mainRef}>
          <InstallTip />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const INSTALL_TIP_KEY = 'fruiqo-install-tip-dismissed';

/** Safari do iPhone/iPad fora do modo instalado: não há prompt de instalação, então ensinamos o caminho. */
export function shouldShowInstallTip(nav: { userAgent: string; platform?: string; maxTouchPoints?: number; standalone?: boolean }, standaloneMode: boolean): boolean {
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  // outros navegadores no iOS (Chrome, Firefox) também instalam hoje, mas o caminho descrito é o do Safari
  const safari = /Safari/.test(nav.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(nav.userAgent);
  return ios && safari && !nav.standalone && !standaloneMode;
}

function InstallTip() {
  const [show, setShow] = useState(() => {
    try {
      if (localStorage.getItem(INSTALL_TIP_KEY)) return false;
    } catch {
      /* sem storage: mostra */
    }
    return shouldShowInstallTip(navigator as Navigator & { standalone?: boolean }, window.matchMedia?.('(display-mode: standalone)').matches ?? false);
  });
  if (!show) return null;
  return (
    <div className="install-tip" role="note">
      <span>
        Use como app: toque em <strong>Compartilhar</strong> <span aria-hidden="true">⬆︎</span> e em <strong>Adicionar à Tela de Início</strong>.
      </span>
      <button
        type="button"
        className="btn btn-icon"
        aria-label="Fechar dica"
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(INSTALL_TIP_KEY, '1');
          } catch {
            /* ignora */
          }
        }}
      >
        ×
      </button>
    </div>
  );
}
