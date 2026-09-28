import type { ShareStatus } from '@fruiqo/contracts';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from './theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : colors.surface;
  const fg = variant === 'secondary' ? colors.text : colors.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

const STATUS_LABEL: Record<ShareStatus, { label: string; color: string }> = {
  queued: { label: 'Na fila', color: colors.muted },
  processing: { label: 'Processando', color: colors.warn },
  done: { label: 'Pronto', color: colors.ok },
  failed: { label: 'Falhou', color: colors.danger },
  rejected: { label: 'Recusado', color: colors.danger },
};

export function StatusBadge({ status }: { status: ShareStatus }) {
  const s = STATUS_LABEL[status];
  return (
    <View style={[styles.badge, { borderColor: s.color }]}>
      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

/** Abre só URLs https públicas (SEC-REQ-12). */
export function openExternal(url: string | undefined) {
  if (!url) return;
  try {
    if (new URL(url).protocol !== 'https:') return;
  } catch {
    return;
  }
  void Linking.openURL(url);
}

export function Link({ title, url }: { title: string; url: string | undefined }) {
  if (!url) return null;
  return (
    <Text accessibilityRole="link" style={styles.link} onPress={() => openExternal(url)}>
      {title}
    </Text>
  );
}

export function Chip({
  label,
  onPress,
  selected,
  disabled,
  hint,
}: {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  /** texto pequeno ao lado do rótulo (ex.: quantos títulos combinam) */
  hint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }}
      onPress={onPress}
      disabled={disabled || !onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: colors.primary, borderColor: colors.primary },
        { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      <Text style={[styles.chipText, selected && { color: colors.primaryText }]}>
        {label}
        {hint ? <Text style={[styles.chipHint, selected && { color: colors.primaryText }]}> {hint}</Text> : null}
      </Text>
    </Pressable>
  );
}

export function ProgressBar({ ratio }: { ratio: number }) {
  const pct = `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%` as const;
  return (
    <View style={styles.progressTrack} accessibilityRole="progressbar">
      <View style={[styles.progressFill, { width: pct }]} />
    </View>
  );
}

/** Pôster (só https, SEC-REQ-12) ou placeholder com a inicial do título. */
export function Poster({ url, title, size = 'md' }: { url?: string; title: string; size?: 'sm' | 'md' }) {
  const dims = size === 'sm' ? { width: 44, height: 66 } : { width: 64, height: 96 };
  if (url?.startsWith('https://')) {
    return <Image source={{ uri: url }} style={[dims, styles.poster]} accessibilityIgnoresInvertColors />;
  }
  return (
    <View style={[dims, styles.poster, styles.posterEmpty]}>
      <Text style={styles.posterLetter}>{title.trim().charAt(0).toUpperCase() || '?'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { fontSize: 14, fontWeight: '500', color: colors.text },
  chipHint: { fontSize: 12, color: colors.muted },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  poster: { borderRadius: 8 },
  posterEmpty: { backgroundColor: '#e8e4fe', alignItems: 'center', justifyContent: 'center' },
  posterLetter: { fontSize: 22, fontWeight: '700', color: colors.primary },
  button: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  link: { color: colors.primary, fontSize: 15, fontWeight: '500' },
});
