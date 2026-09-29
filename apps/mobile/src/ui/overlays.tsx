// Painel inferior (sheet) e aviso com ação (snackbar), no tema "cinema noturno".
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './components';
import { colors, ui } from './theme';

export function Sheet({
  visible,
  title,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} accessibilityLabel="Fechar" />
      <View
        style={{
          maxHeight: '85%',
          backgroundColor: colors.bg,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          borderTopWidth: 1,
          borderColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 12),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
          <Text style={[ui.h2, { flex: 1 }]} accessibilityRole="header">
            {title}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar" onPress={onClose} hitSlop={10} style={{ padding: 8 }}>
            <Icon name="close" size={22} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[ui.pad, { paddingTop: 4 }]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={{ paddingHorizontal: 16, gap: 8 }}>{footer}</View> : null}
      </View>
    </Modal>
  );
}

export type SnackbarState = { message: string; actionLabel?: string; onAction?: () => void } | null;

/** Aviso no rodapé por ~8 s (tempo para "Desfazer"); some sozinho. */
export function Snackbar({ state, onDismiss, bottom = 16 }: { state: SnackbarState; onDismiss: () => void; bottom?: number }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state) return;
    timer.current = setTimeout(onDismiss, 8000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, onDismiss]);
  if (!state) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 14,
        backgroundColor: colors.surface3,
        borderWidth: 1,
        borderColor: colors.borderStrong,
        shadowColor: colors.shadow,
        shadowOpacity: 0.35,
        shadowRadius: 12,
        elevation: 8,
      }}
    >
      <Text style={[ui.body, { flex: 1, color: colors.text }]}>{state.message}</Text>
      {state.actionLabel && state.onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            state.onAction?.();
            onDismiss();
          }}
          hitSlop={8}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: colors.primary2, fontWeight: '800', fontSize: 15 }}>{state.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Estado simples de snackbar para as telas. */
export function useSnackbar() {
  const [state, setState] = useState<SnackbarState>(null);
  return { state, show: setState, dismiss: () => setState(null) };
}
