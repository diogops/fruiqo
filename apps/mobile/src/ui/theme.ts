import { StyleSheet } from 'react-native';

// Identidade "cinema noturno" (mesmos tokens do web): grafite/cinza-azulado + azul de marca.
// Escuro é o padrão do produto; o claro usa cinzas claros azulados. `colors`, `gradients` e `ui`
// são objetos estáveis cujo conteúdo é trocado por `applyTheme` — as telas os leem na renderização
// e re-renderizam via `useTheme()` (ThemeProvider).

export type ThemeName = 'dark' | 'light';
export type ThemePreference = 'system' | 'dark' | 'light';

/** "Sistema" segue o aparelho; sem informação, vale o padrão do produto (escuro). */
export function resolveTheme(preference: ThemePreference, system: string | null | undefined): ThemeName {
  if (preference === 'system') return system === 'light' ? 'light' : 'dark';
  return preference;
}

const darkColors = {
  bg: '#0b1220',
  bg2: '#0f172a',
  surface: '#172033',
  surface2: '#1e293b',
  surface3: '#27344a',
  border: 'rgba(148,163,184,0.18)',
  borderStrong: 'rgba(148,163,184,0.3)',
  text: '#e8eef9',
  text2: '#c3cddd',
  muted: '#8e9bb3',
  primary: '#3b82f6',
  primary2: '#60a5fa',
  primary3: '#1d4ed8',
  accent: '#22d3ee',
  primarySoft: 'rgba(59,130,246,0.16)',
  primarySoftBorder: 'rgba(96,165,250,0.3)',
  heroBorder: 'rgba(96,165,250,0.28)',
  primaryText: '#ffffff',
  danger: '#f87171',
  dangerSoft: 'rgba(248,113,113,0.16)',
  dangerBorder: 'rgba(248,113,113,0.4)',
  ok: '#34d399',
  warn: '#fbbf24',
  star: '#fbbf24',
  shadow: '#020617',
  overlay: 'rgba(2,6,23,0.55)',
};

const lightColors: typeof darkColors = {
  bg: '#f4f7fb',
  bg2: '#eaf0f7',
  surface: '#ffffff',
  surface2: '#eef2f8',
  surface3: '#e2e8f0',
  border: 'rgba(51,65,85,0.14)',
  borderStrong: 'rgba(51,65,85,0.26)',
  text: '#0f172a',
  text2: '#334155',
  muted: '#64748b',
  primary: '#2563eb',
  primary2: '#1d4ed8',
  primary3: '#1e40af',
  accent: '#0891b2',
  primarySoft: 'rgba(37,99,235,0.1)',
  primarySoftBorder: 'rgba(37,99,235,0.28)',
  heroBorder: 'rgba(37,99,235,0.22)',
  primaryText: '#ffffff',
  danger: '#dc2626',
  dangerSoft: 'rgba(220,38,38,0.08)',
  dangerBorder: 'rgba(220,38,38,0.35)',
  ok: '#059669',
  warn: '#d97706',
  star: '#f59e0b',
  shadow: '#1e293b',
  overlay: 'rgba(15,23,42,0.45)',
};

// degradês (React Native 0.86: experimental_backgroundImage aceita CSS linear-gradient)
const darkGradients = {
  brand: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 45%, #22d3ee 110%)',
  hero: 'linear-gradient(160deg, #1e3a8a 0%, #172033 55%, #0b1220 100%)',
  card: 'linear-gradient(160deg, #1e293b 0%, #172033 60%, #0f172a 100%)',
  screen: 'linear-gradient(180deg, #0f172a 0%, #0b1220 100%)',
  posterFallback: 'linear-gradient(160deg, #1e3a8a 0%, #0f172a 100%)',
  // capa das listas: sempre escura, porque as iniciais são brancas
  cover: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #0891b2 120%)',
  scrim: 'linear-gradient(180deg, rgba(11,18,32,0) 0%, rgba(11,18,32,0.85) 70%, #0b1220 100%)',
};

const lightGradients: typeof darkGradients = {
  brand: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 45%, #06b6d4 115%)',
  hero: 'linear-gradient(160deg, #dbeafe 0%, #eef4fb 55%, #ffffff 100%)',
  card: 'linear-gradient(160deg, #ffffff 0%, #f5f8fc 60%, #eef3f9 100%)',
  screen: 'linear-gradient(180deg, #f8fafc 0%, #eef3f9 100%)',
  posterFallback: 'linear-gradient(160deg, #3b82f6 0%, #1e3a8a 100%)',
  cover: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #0891b2 120%)',
  scrim: 'linear-gradient(180deg, rgba(244,247,251,0) 0%, rgba(244,247,251,0.88) 70%, #f4f7fb 100%)',
};

function buildUi(c: typeof darkColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    pad: { padding: 16, gap: 14 },
    h1: { fontSize: 26, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
    h2: { fontSize: 18, fontWeight: '700', color: c.text, letterSpacing: -0.2 },
    body: { fontSize: 15, lineHeight: 22, color: c.text2 },
    muted: { fontSize: 13, lineHeight: 18, color: c.muted },
    card: {
      backgroundColor: c.surface,
      borderRadius: 16,
      padding: 16,
      gap: 8,
      borderWidth: 1,
      borderColor: c.border,
    },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface2,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: c.text,
    },
    error: { color: c.danger, fontSize: 14 },
    eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, color: c.primary2 },
    heroCard: {
      borderRadius: 20,
      padding: 18,
      gap: 10,
      borderWidth: 1,
      borderColor: c.heroBorder,
      backgroundColor: c.surface,
      overflow: 'hidden',
      shadowColor: c.shadow,
      shadowOpacity: c === lightColors ? 0.12 : 0.5,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: c === lightColors ? 3 : 8,
    },
    pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: c.primarySoft, borderWidth: 1, borderColor: c.primarySoftBorder },
    pillText: { fontSize: 12, fontWeight: '700', color: c.primary2 },
  });
}

export const colors = { ...darkColors };
export const gradients = { ...darkGradients };
export const ui = buildUi(darkColors);

let current: ThemeName = 'dark';
const listeners = new Set<(name: ThemeName) => void>();

export function currentTheme(): ThemeName {
  return current;
}

/** Troca os tokens no lugar. Estilos derivados (ex.: `components.tsx`) se reconstroem via `onThemeChange`. */
export function applyTheme(name: ThemeName) {
  if (name === current) return;
  current = name;
  const c = name === 'dark' ? darkColors : lightColors;
  Object.assign(colors, c);
  Object.assign(gradients, name === 'dark' ? darkGradients : lightGradients);
  Object.assign(ui, buildUi(c));
  for (const l of listeners) l(name);
}

export function onThemeChange(listener: (name: ThemeName) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
