// Ferramentas de dev (simulador de share) só fora de produção. O valor vem do app.config.js (extra.appVariant).
import Constants from 'expo-constants';

export const devToolsEnabled: boolean = (Constants.expoConfig?.extra?.appVariant ?? 'development') !== 'production';
