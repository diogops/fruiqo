import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#ffffff',
  surface: '#f4f5f7',
  border: '#e2e4e9',
  text: '#16181d',
  muted: '#5f6673',
  primary: '#5b3df5',
  primaryText: '#ffffff',
  danger: '#c62828',
  ok: '#2e7d32',
  warn: '#b26a00',
};

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, gap: 12 },
  h1: { fontSize: 24, fontWeight: '700', color: colors.text },
  h2: { fontSize: 17, fontWeight: '600', color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
  muted: { fontSize: 13, lineHeight: 18, color: colors.muted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 14 },
});
