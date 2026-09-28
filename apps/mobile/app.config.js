// @ts-check

// development/preview apontam para uma API local em HTTP; production exige HTTPS.
/** @type {'development' | 'preview' | 'production'} */
// @ts-ignore -- valor vem do ambiente
const variant = process.env.APP_VARIANT ?? 'development';
const allowCleartext = variant !== 'production';
// O development build (expo-dev-client) instala lado a lado com o preview: id, nome e scheme próprios.
const isDev = variant === 'development';
const appId = isDev ? 'com.fruiqo.app.dev' : 'com.fruiqo.app';

/** @param {import('expo/config').ConfigContext} ctx @returns {import('expo/config').ExpoConfig} */
module.exports = ({ config }) => ({
  ...config,
  name: isDev ? 'Fruiqo (dev)' : 'Fruiqo',
  slug: 'fruiqo',
  scheme: isDev ? 'fruiqo-dev' : 'fruiqo',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: appId,
    supportsTablet: false,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: appId,
    // RF-40: galeria/arquivos usam os seletores do sistema (Photo Picker/SAF), que não exigem permissão.
    // Bloqueia as permissões de armazenamento/mídia/microfone que bibliotecas declaram por padrão.
    blockedPermissions: [
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.RECORD_AUDIO',
      // biometria vem do expo-secure-store e não é usada
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
      // overlay só é útil para o menu de dev do React Native
      ...(isDev ? [] : ['android.permission.SYSTEM_ALERT_WINDOW']),
    ],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-image-picker',
      {
        // iOS: sem NSPhotoLibraryUsageDescription (o PHPicker não precisa) e sem microfone.
        photosPermission: false,
        microphonePermission: false,
        cameraPermission: 'O Fruiqo usa a câmera para você fotografar listas de filmes, séries e músicas. A foto é lida no seu aparelho e não sai do celular.',
      },
    ],
    'expo-document-picker',
    [
      'expo-build-properties',
      { android: { usesCleartextTraffic: allowCleartext } },
    ],
    [
      'expo-share-intent',
      {
        iosAppGroupIdentifier: `group.${appId}`,
        iosActivationRules: {
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsWebPageWithMaxCount: 1,
          NSExtensionActivationSupportsImageWithMaxCount: 10,
          NSExtensionActivationSupportsMovieWithMaxCount: 1,
          NSExtensionActivationSupportsFileWithMaxCount: 1,
        },
        androidIntentFilters: ['text/*', 'image/*', 'application/pdf'],
        androidMultiIntentFilters: ['image/*'],
      },
    ],
  ],
  owner: 'chacall_gyn',
  extra: {
    appVariant: variant,
    eas: { projectId: 'c743c3b4-3834-47af-8f6e-6148b1698cd5' },
  },
});
