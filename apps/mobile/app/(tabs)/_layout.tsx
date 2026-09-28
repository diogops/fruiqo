import { Tabs } from 'expo-router';
import { type ColorValue, Text } from 'react-native';

import { colors } from '../../src/ui/theme';

// Ícones como glifos de texto: evita biblioteca de ícones (e um novo build nativo) nesta etapa.
function Glyph({ symbol, color }: { symbol: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 18, lineHeight: 22 }}>{symbol}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
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
