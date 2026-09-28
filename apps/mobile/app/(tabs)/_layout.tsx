import { Tabs } from 'expo-router';
import { type ColorValue, Text } from 'react-native';

import { colors } from '../../src/ui/theme';

// Ícones como glifos de texto: evita biblioteca de ícones (e um novo build nativo) nesta etapa.
function Glyph({ symbol, color }: { symbol: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 20, lineHeight: 24, fontWeight: '700' }}>{symbol}</Text>;
}

export default function TabsLayout() {
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
        options={{ title: 'Início', headerTitle: 'Fruiqo', tabBarIcon: ({ color }) => <Glyph symbol="⌂" color={color} /> }}
      />
      <Tabs.Screen
        name="lists"
        options={{ title: 'Listas', tabBarIcon: ({ color }) => <Glyph symbol="☰" color={color} /> }}
      />
      <Tabs.Screen
        name="inbox"
        options={{ title: 'Compartilhamentos', tabBarLabel: 'Recebidos', tabBarIcon: ({ color }) => <Glyph symbol="⇩" color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Ajustes', tabBarIcon: ({ color }) => <Glyph symbol="⚙" color={color} /> }}
      />
    </Tabs>
  );
}
