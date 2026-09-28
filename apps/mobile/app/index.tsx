import { ActivityIndicator, View } from 'react-native';

import { colors } from '../src/ui/theme';

// Rota inicial vazia: o Gate do _layout decide entre consentimento, login e inbox.
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
