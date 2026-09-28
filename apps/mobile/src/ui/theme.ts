import { StyleSheet } from 'react-native';

// Identidade "cinema noturno" (mesmos tokens do web): grafite/cinza-azulado + azul de marca.
// O app usa o tema escuro como padrão do produto.
export const colors = {
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
  primaryText: '#ffffff',
  danger: '#f87171',
  ok: '#34d399',
  warn: '#fbbf24',
  star: '#fbbf24',
};

// degradês (React Native 0.86: experimental_backgroundImage aceita CSS linear-gradient)
export const gradients = {
  brand: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 45%, #22d3ee 110%)',
  hero: 'linear-gradient(160deg, #1e3a8a 0%, #172033 55%, #0b1220 100%)',
  card: 'linear-gradient(160deg, #1e293b 0%, #172033 60%, #0f172a 100%)',
  screen: 'linear-gradient(180deg, #0f172a 0%, #0b1220 100%)',
  posterFallback: 'linear-gradient(160deg, #1e3a8a 0%, #0f172a 100%)',
  scrim: 'linear-gradient(180deg, rgba(11,18,32,0) 0%, rgba(11,18,32,0.85) 70%, #0b1220 100%)',
};

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, gap: 14 },
  h1: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  h2: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, color: colors.text2 },
  muted: { fontSize: 13, lineHeight: 18, color: colors.muted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 14 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, color: colors.primary2 },
  heroCard: {
    borderRadius: 20,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.28)',
    backgroundColor: colors.surface,
    overflow: 'hidden',
    shadowColor: '#020617',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: 'rgba(96,165,250,0.3)' },
  pillText: { fontSize: 12, fontWeight: '700', color: colors.primary2 },
});
