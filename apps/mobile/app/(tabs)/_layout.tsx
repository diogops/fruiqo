import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ColorValue } from 'react-native';

import { colors } from '../../src/ui/theme';
import { useTheme } from '../../src/ui/ThemeProvider';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Ionicons: ícone cheio na aba ativa, contorno nas demais.
function tabIcon(active: IconName, idle: IconName) {
  return ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <Ionicons name={focused ? active : idle} size={size ?? 24} color={color as string} />
  );
}

export default function TabsLayout() {
  useTheme(); // re-renderiza na troca de tema
  return (
    <Tabs
      screenOptions={{
        headerTintColor: colors.primary2,
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text, fontWeight: '800' },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.primary2,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.bg2, borderTopColor: colors.border, height: 64, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: 'Início', headerTitle: 'Fruiqo', tabBarIcon: tabIcon('home', 'home-outline') }}
      />
      <Tabs.Screen
        name="lists"
        options={{ title: 'Listas', tabBarIcon: tabIcon('albums', 'albums-outline') }}
      />
      <Tabs.Screen
        name="inbox"
        options={{ title: 'Compartilhamentos', tabBarLabel: 'Recebidos', tabBarIcon: tabIcon('download', 'download-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Ajustes', tabBarIcon: tabIcon('settings', 'settings-outline') }}
      />
    </Tabs>
  );
}
