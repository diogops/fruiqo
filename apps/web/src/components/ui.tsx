// Primitivas visuais do design system: ícones (SVG inline, sem dependência), tema, menu acessível e estado vazio.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

const PATHS = {
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  review: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  flask: 'M9 3h6M10 3v6L4.5 18.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3M7 15h10',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  up: 'M18 15l-6-6-6 6',
  down: 'M6 9l6 6 6-6',
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6L6 18M6 6l12 12',
  top: 'M17 11l-5-5-5 5M12 6v14M5 3h14',
  bottom: 'M7 13l5 5 5-5M12 18V4M5 21h14',
  hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  sparkles: 'M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  play: 'M6 4l14 8-14 8z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Marca do Fruiqo: fotograma estilizado com um "play" em degradê. */
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M8 5.5v13l10.5-6.5z" fill="#fff" />
      </svg>
    </span>
  );
}

// ----------------------------------------------------------------- tema

export type ThemeChoice = 'dark' | 'light' | 'system';
const THEME_KEY = 'fruiqo-theme';
const THEME_ORDER: ThemeChoice[] = ['dark', 'light', 'system'];
const THEME_LABEL: Record<ThemeChoice, string> = { dark: 'Tema escuro', light: 'Tema claro', system: 'Tema do sistema' };
const THEME_ICON: Record<ThemeChoice, IconName> = { dark: 'moon', light: 'sun', system: 'monitor' };

function readTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark' || t === 'light' || t === 'system') return t;
  } catch {
    /* armazenamento indisponível: usa o padrão */
  }
  return 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignora */
    }
  }, [theme]);
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]!;
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setTheme(next)}
      aria-label={`${THEME_LABEL[theme]} (trocar para ${THEME_LABEL[next].toLowerCase()})`}
      title={THEME_LABEL[theme]}
    >
      <Icon name={THEME_ICON[theme]} />
    </button>
  );
}

// ---------------------------------------------------------- menu acessível

/**
 * Dropdown com botão de disparo: abre/fecha no clique, fecha com Esc ou clique fora
 * e devolve o foco ao botão. O conteúdo recebe `close` para fechar após uma ação.
 */
export function Menu({
  label,
  trigger,
  children,
  triggerClassName = 'icon-btn',
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) wrapRef.current?.querySelector<HTMLElement>('.menu button, .menu input')?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div className="menu" id={menuId} role="group" aria-label={label}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------ estados auxiliares

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <svg viewBox="0 0 120 90" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="es-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3b82f6" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <rect x="14" y="16" width="40" height="58" rx="6" fill="url(#es-g)" opacity="0.25" transform="rotate(-8 34 45)" />
        <rect x="40" y="12" width="40" height="58" rx="6" fill="url(#es-g)" opacity="0.45" />
        <rect x="66" y="16" width="40" height="58" rx="6" fill="url(#es-g)" opacity="0.25" transform="rotate(8 86 45)" />
        <path d="M55 33v18l14-9z" fill="#fff" opacity="0.9" />
      </svg>
      <strong>{title}</strong>
      {children && <span className="small">{children}</span>}
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton" style={{ width: 38, height: 57 }} />
          <div style={{ flex: 1, display: 'grid', gap: 8 }}>
            <div className="skeleton" style={{ width: `${50 + ((i * 13) % 35)}%`, height: 12 }} />
            <div className="skeleton" style={{ width: '28%', height: 10 }} />
          </div>
          <div className="skeleton" style={{ width: 90, height: 26, borderRadius: 999 }} />
        </div>
      ))}
    </div>
  );
}

/** Pôster pequeno com fallback em degradê e inicial. */
export function Thumb({ src, title, width = 38, height = 57 }: { src?: string | null; title: string; width?: number; height?: number }) {
  if (src) return <img className="thumb" src={src} alt="" width={width} height={height} loading="lazy" />;
  return (
    <span className="thumb thumb-fallback" style={{ width, height }} aria-hidden="true">
      {title.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
