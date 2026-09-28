// @ts-check

// development/preview apontam para uma API local em HTTP; production exige HTTPS.
/** @type {'development' | 'preview' | 'production'} */
// @ts-ignore -- valor vem do ambiente
const variant = process.env.APP_VARIANT ?? 'development';
const allowCleartext = variant !== 'production';

/** @param {import('expo/config').ConfigContext} ctx @returns {import('expo/config').ExpoConfig} */
module.exports = ({ config }) => ({
  ...config,
  name: 'Fruiqo',
  slug: 'fruiqo',
  scheme: 'fruiqo',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.fruiqo.app',
    supportsTablet: false,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: 'com.fruiqo.app',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-build-properties',
      { android: { usesCleartextTraffic: allowCleartext } },
    ],
    [
      'expo-share-intent',
      {
        iosAppGroupIdentifier: 'group.com.fruiqo.app',
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
