import type { ShareStatus } from '@fruiqo/contracts';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

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

const styles = StyleSheet.create({
  button: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  link: { color: colors.primary, fontSize: 15, fontWeight: '500' },
});
